# Typed Repository Clients — Phase 1: Read Primitives & Entity Identity Map (Component A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add to TODL's reflective `Repository` a memoized, id-keyed entity factory plus scalar/reference read accessors, and an `Entity`/`EntityBase` lens type — the reflective foundation every later typed-client phase builds on, with zero codegen.

**Architecture:** Purely additive on the existing `Repository`/`Graph`. New `Repository` methods (`attr`, `ref`, `refs`, `referrers`, `danglingRefs`, `entity`) are thin wrappers over the already-present `effectiveFields`, `effectiveRelationships`, `related`, and adjacency queries. A new `src/model/entity.ts` holds the `Entity` interface and a concrete `EntityBase` lens whose reads delegate live to the `Repository` (same pattern as `ReactiveNode`), so entities are lazy id-keyed views — never deep-copied POJOs — memoized in an identity map so `a.ref('x') === b.ref('x')` and reference cycles are safe.

**Tech Stack:** TypeScript (ESM, strict tsconfig with `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), Node's built-in test runner via `tsx` (`node:test` + `node:assert/strict`).

## Global Constraints

- **This plan is Phase 1 of 7** from the spec `docs/superpowers/specs/2026-08-06-typed-repository-clients-and-authoring-design.md` §14. Build **only** Component A (spec §4). Do NOT build hydration/freeze (Phase 2), codegen (Phase 3/5), `ModelDraft` (Phase 4), or the `GraphStore` seam (Phase 6/7).
- **Additive only.** The existing `Repository`/`Graph` engine is unchanged in behaviour; every existing test must stay green. No signature changes to existing methods.
- **Scalar vs reference is decided by storage, read through split accessors** (spec §2, type-directed model, todl ≥ 0.14): a scalar lives in `Node.attrs` and is read by `attr`/`field`; a reference is an `EdgeKind.Relationship` edge (`via` = member name) and is read by `ref`/`refs`. Consumers never see `EdgeKind`/`Direction`/`via`.
- **Absence is `undefined`, never a throw** (spec §4). A missing node, missing attr, or dangling reference yields `undefined` at the point of navigation; `danglingRefs()` reports dangling edges in bulk.
- **Entities are lazy id-keyed lenses, memoized (identity map)** (spec §4): same id → same instance; reads are live against the `Repository`, so there is no snapshot to invalidate.
- **Every test file lives in a `tests/` subfolder next to its source** (`src/model/tests/…`), never beside the source. The runner globs `src/**/*.test.ts`.
- **Use real enums**, never string-literal unions.
- Test command (whole suite): `npx tsx --conditions=development --test "src/**/*.test.ts"`. Single file: `npx tsx --conditions=development --test src/model/tests/<file>.test.ts`. Typecheck: `npm run typecheck`.

### Resolved design decisions (read before starting — these are the non-obvious calls)

1. **`attr`/`ref`/`refs` use effective (class-merged) semantics.** They delegate to the existing `effectiveFields(id)` / `effectiveRelationships(id)`, so an instance authored `instanceof` a class surfaces the class's fixed field values and relationships. Rationale: that is the correct instance view and the merge logic already exists. Note `effectiveFields` makes **class-fixed values win over the leaf's own attrs** (a class is a fixed-value definition) — tests assert this.
2. **`referrers` uses raw reverse adjacency** (`related(id, EdgeKind.Relationship, Direction.In, member)`). Reverse class-merge is out of scope (YAGNI).
3. **`EntityBase.fields` excludes the structural markers** `class`, `id`, `namespace`; `field(name)` is unfiltered (asking for `"namespace"` by name returns it).
4. **`type()` returns `Entity | undefined`** (a relaxation of the spec's `Entity`): an instance's `typeOf` is a concept node and resolves, but a meta node's `typeOf` is a `MetaKind` string (e.g. `"concept"`) that is not a node id, so it returns `undefined` there rather than throwing. Honours the no-throw rule.
5. **`danglingRefs()` is implemented in Phase 1 but only its negative case is testable here.** `Graph.addEdge` and `fromJSON` both throw on a missing edge target, and there is no node-removal API, so a single well-formed `Repository` cannot contain a dangling reference. The positive case (an overlay edge into a base node absent from the overlay graph) is naturally constructible and tested in **Phase 4**. Phase 1 tests only that a well-formed graph reports `[]`. Do not add a removal API or bypass `addEdge` validation to force a positive case.

### File structure

- `src/model/entity.ts` *(create)* — the `Entity` interface + `EntityBase` lens. One responsibility: expose a single node as a typed-navigable read lens over a `Repository`. Imports `Repository`/`ConceptSchema` **type-only** (breaks the value cycle, mirroring `reactive.ts`).
- `src/model/model.ts` *(modify)* — add the read primitives (`attr`, `ref`, `refs`, `referrers`, `danglingRefs`) and the memoized `entity()` factory + its `entityCache` field. Value-imports `EntityBase` from `entity.ts`.
- `src/index.ts` *(modify)* — export `EntityBase` and the `Entity` type.
- `src/model/tests/read-primitives.test.ts` *(create)* — Task 1 tests.
- `src/model/tests/entity.test.ts` *(create)* — Task 2 tests.
- `src/model/tests/entity-integration.test.ts` *(create)* — Task 3 tests.

---

## Task 1: Repository read primitives (`attr`, `ref`, `refs`, `referrers`, `danglingRefs`)

**Files:**
- Modify: `src/model/model.ts` (add five methods to `class Repository`, after `effectiveRelationships`, before `schemaOf`)
- Test: `src/model/tests/read-primitives.test.ts` (create)

**Interfaces:**
- Consumes (existing, already on `Repository`): `has(id): boolean`; `resolve(id): Node | undefined`; `allNodes(): Node[]`; `outEdges(id): Edge[]`; `related(id, kind: EdgeKind, direction: Direction, via: NodeId | null): NodeId[]`; `effectiveFields(leaf): Map<string, Scalar>`; `effectiveRelationships(leaf): Map<string, NodeId[]>`. Enums `EdgeKind`, `Direction` and type `Scalar`, `NodeId` are already imported at the top of `model.ts`.
- Produces (later tasks + phases rely on these exact signatures):
  - `attr(id: NodeId, name: string): Scalar | undefined`
  - `ref(id: NodeId, member: string): NodeId | undefined`
  - `refs(id: NodeId, member: string): NodeId[]`
  - `referrers(id: NodeId, member?: string): NodeId[]`
  - `danglingRefs(): { from: NodeId; member: string; to: NodeId }[]`

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/read-primitives.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";

// A small instance graph: a `component` gw whose reference field `implemented-by`
// points at a `technology` copilot; plus a `component` class `web-app` with a
// fixed `label` and an instance `portal` that `instanceof` it.
function fixture(): Repository {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("technology");
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "implemented-by", "copilot");
  b.assertInstance("component", "web-app", true); // asClass
  b.setField("web-app", "label", "Web App default");
  b.assertInstance("component", "portal");
  b.addInstanceOf("portal", "web-app");
  b.commit();
  return repo;
}

test("attr reads a scalar field; missing attr and missing node are undefined", () => {
  const repo = fixture();
  assert.equal(repo.attr("gw", "label"), "Gateway");
  assert.equal(repo.attr("gw", "nope"), undefined);
  assert.equal(repo.attr("ghost", "label"), undefined);
});

test("attr is class-merged: a class's fixed value wins for an instanceof leaf", () => {
  const repo = fixture();
  assert.equal(repo.attr("portal", "label"), "Web App default");
});

test("ref returns the single relationship target; refs returns all; absent is undefined/[]", () => {
  const repo = fixture();
  assert.equal(repo.ref("gw", "implemented-by"), "copilot");
  assert.deepEqual(repo.refs("gw", "implemented-by"), ["copilot"]);
  assert.equal(repo.ref("gw", "none"), undefined);
  assert.deepEqual(repo.refs("gw", "none"), []);
});

test("referrers returns inbound relationship sources, optionally filtered by member", () => {
  const repo = fixture();
  assert.deepEqual(repo.referrers("copilot", "implemented-by"), ["gw"]);
  assert.deepEqual(repo.referrers("copilot"), ["gw"]);
  assert.deepEqual(repo.referrers("copilot", "other"), []);
});

test("danglingRefs is empty for a well-formed graph (positive case is Phase 4)", () => {
  const repo = fixture();
  assert.deepEqual(repo.danglingRefs(), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/read-primitives.test.ts`
Expected: FAIL — `repo.attr is not a function` (and the other four methods undefined).

- [ ] **Step 3: Add the five methods to `Repository`**

In `src/model/model.ts`, insert into `class Repository` immediately after the `effectiveRelationships(...)` method (around line 230, before `schemaOf`):

```ts
  // ── Read primitives (typed-client foundation, spec §4) ────────────────────

  /** A node's effective scalar field value (class-merged), or undefined. */
  attr(id: NodeId, name: string): Scalar | undefined {
    return this.effectiveFields(id).get(name);
  }

  /** The single target of reference member `member` (class-merged), or undefined. */
  ref(id: NodeId, member: string): NodeId | undefined {
    return this.refs(id, member)[0];
  }

  /** All targets of reference member `member` (class-merged); [] if none. */
  refs(id: NodeId, member: string): NodeId[] {
    return this.effectiveRelationships(id).get(member) ?? [];
  }

  /** Inbound reference sources (reverse adjacency), optionally filtered by member. */
  referrers(id: NodeId, member?: string): NodeId[] {
    return this.related(id, EdgeKind.Relationship, Direction.In, member ?? null);
  }

  /** Every relationship edge whose target node is absent (bulk dangling report). */
  danglingRefs(): { from: NodeId; member: string; to: NodeId }[] {
    const result: { from: NodeId; member: string; to: NodeId }[] = [];
    for (const node of this.allNodes()) {
      for (const edge of this.outEdges(node.id)) {
        if (edge.kind === EdgeKind.Relationship && edge.via !== null && !this.has(edge.to)) {
          result.push({ from: node.id, member: edge.via, to: edge.to });
        }
      }
    }
    return result;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/read-primitives.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Run the full suite + typecheck to confirm no regression**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: whole suite green, `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/model/model.ts src/model/tests/read-primitives.test.ts
git commit -m "feat(model): add Repository read primitives attr/ref/refs/referrers/danglingRefs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `Entity`/`EntityBase` lens + memoized `entity()` identity map

**Files:**
- Create: `src/model/entity.ts`
- Modify: `src/model/model.ts` (import `EntityBase`; add `entityCache` field + `entity()` method)
- Test: `src/model/tests/entity.test.ts` (create)

**Interfaces:**
- Consumes: the Task 1 primitives (`attr`, `ref`, `refs`, `referrers`); existing `Repository` methods `resolve`, `has`, `effectiveFields`, `effectiveSchema(concept): ConceptSchema`, `supertypesOf(concept): NodeId[]`, `classOf(leaf): NodeId | null`; existing types `Tier`, `Scalar`, `NodeId`, `Node`, `ConceptSchema`.
- Produces:
  - `interface Entity` (shape below) exported from `src/model/entity.ts`.
  - `class EntityBase implements Entity` with constructor `(repo: Repository, id: NodeId)`.
  - `Repository.entity<T extends Entity = Entity>(id: NodeId): T | undefined` — memoized; same id → same instance.

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/entity.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { Tier } from "../graph.js";

// component/technology instances plus an `app-component : component` subtype and
// a `web-app` class, and a mutual reference cycle a <-> b via member `peer`.
function fixture(): Repository {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("app-component", "component"); // extends component
  b.defineConcept("technology");
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "implemented-by", "copilot");
  b.assertInstance("app-component", "portal-svc");
  b.assertInstance("component", "web-app", true); // class
  b.setField("web-app", "label", "Web App default");
  b.assertInstance("component", "portal");
  b.addInstanceOf("portal", "web-app");
  b.assertInstance("component", "a");
  b.assertInstance("component", "b");
  b.addRelationship("a", "peer", "b");
  b.addRelationship("b", "peer", "a");
  b.commit();
  return repo;
}

test("entity exposes id, concept, tier, and scalar fields", () => {
  const repo = fixture();
  const gw = repo.entity("gw")!;
  assert.equal(gw.id, "gw");
  assert.equal(gw.concept, "component");
  assert.equal(gw.tier, Tier.Instance);
  assert.equal(gw.field("label"), "Gateway");
});

test("entity() is undefined for a missing node", () => {
  assert.equal(fixture().entity("ghost"), undefined);
});

test("entity() is an identity map: same id yields the same instance", () => {
  const repo = fixture();
  assert.equal(repo.entity("gw"), repo.entity("gw"));
});

test("navigation returns shared handles from the identity map", () => {
  const repo = fixture();
  const gw = repo.entity("gw")!;
  assert.equal(gw.ref("implemented-by"), repo.entity("copilot"));
  assert.equal(gw.ref("implemented-by")!.id, "copilot");
});

test("reference cycles are safe to navigate", () => {
  const repo = fixture();
  const a = repo.entity("a")!;
  assert.equal(a.ref("peer")!.ref("peer"), a);
});

test("refs and referrers return Entity arrays", () => {
  const repo = fixture();
  assert.deepEqual(repo.entity("gw")!.refs("implemented-by").map((e) => e.id), ["copilot"]);
  assert.deepEqual(repo.entity("copilot")!.referrers("implemented-by").map((e) => e.id), ["gw"]);
});

test("type() resolves an instance's concept as an Entity; schema() reflects it", () => {
  const repo = fixture();
  const gw = repo.entity("gw")!;
  assert.equal(gw.type()!.id, "component");
  assert.equal(gw.schema().concept, "component");
});

test("is() is subtype- and instanceOf-aware", () => {
  const repo = fixture();
  assert.equal(repo.entity("gw")!.is("component"), true);
  assert.equal(repo.entity("gw")!.is("technology"), false);
  assert.equal(repo.entity("portal-svc")!.is("component"), true); // via extends
  assert.equal(repo.entity("portal")!.is("web-app"), true); // via instanceof
});

test("fields excludes structural markers but field() reads them by name", () => {
  const repo = fixture();
  const webApp = repo.entity("web-app")!;
  assert.equal(webApp.fields.has("class"), false);
  assert.equal(webApp.fields.get("label"), "Web App default");
  assert.equal(webApp.field("class"), true); // by name, unfiltered
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/entity.test.ts`
Expected: FAIL — `repo.entity is not a function`.

- [ ] **Step 3: Create `src/model/entity.ts`**

```ts
/**
 * A read lens over a single model node (design spec §4, Component A). Reads
 * delegate live to the {@link Repository}, so an entity is a lazy id-keyed view
 * — never a deep copy — which preserves identity, sharing, and reverse
 * navigation. Same pattern as {@link ReactiveNode}: a type-only import of
 * Repository breaks the value cycle.
 */

import { Tier, type NodeId, type Scalar } from "./graph.js";
import type { Repository, ConceptSchema } from "./model.js";

/** Structural attrs that are markers, not authored fields (hidden from `fields`). */
const MARKER_ATTRS = new Set(["class", "id", "namespace"]);

/** The untyped base every (future) generated concept class extends. */
export interface Entity {
  readonly id: string;
  readonly concept: string; // the node's typeOf
  readonly tier: Tier;
  field(name: string): Scalar | undefined;
  readonly fields: ReadonlyMap<string, Scalar>;
  ref(member: string): Entity | undefined;
  refs(member: string): Entity[];
  referrers(member?: string): Entity[];
  /** The concept as an Entity, or undefined for a node whose typeOf is a meta-kind. */
  type(): Entity | undefined;
  schema(): ConceptSchema;
  /** True if this node's concept is, extends, or `instanceof`s `conceptOrClass`. */
  is(conceptOrClass: string): boolean;
}

export class EntityBase implements Entity {
  constructor(
    private readonly repo: Repository,
    readonly id: NodeId,
  ) {}

  get concept(): string {
    return this.repo.resolve(this.id)?.typeOf ?? "";
  }

  get tier(): Tier {
    return this.repo.resolve(this.id)?.tier ?? Tier.Instance;
  }

  field(name: string): Scalar | undefined {
    return this.repo.attr(this.id, name);
  }

  get fields(): ReadonlyMap<string, Scalar> {
    const out = new Map<string, Scalar>();
    for (const [key, value] of this.repo.effectiveFields(this.id)) {
      if (!MARKER_ATTRS.has(key)) out.set(key, value);
    }
    return out;
  }

  ref(member: string): Entity | undefined {
    const to = this.repo.ref(this.id, member);
    return to === undefined ? undefined : this.repo.entity(to);
  }

  refs(member: string): Entity[] {
    return this.mapEntities(this.repo.refs(this.id, member));
  }

  referrers(member?: string): Entity[] {
    return this.mapEntities(this.repo.referrers(this.id, member));
  }

  type(): Entity | undefined {
    return this.repo.entity(this.concept);
  }

  schema(): ConceptSchema {
    return this.repo.effectiveSchema(this.concept);
  }

  is(conceptOrClass: string): boolean {
    const concept = this.concept;
    if (concept === conceptOrClass) return true;
    if (this.repo.supertypesOf(concept).includes(conceptOrClass)) return true;
    return this.repo.classOf(this.id) === conceptOrClass;
  }

  private mapEntities(ids: readonly NodeId[]): Entity[] {
    const out: Entity[] = [];
    for (const id of ids) {
      const e = this.repo.entity(id);
      if (e !== undefined) out.push(e);
    }
    return out;
  }
}
```

- [ ] **Step 4: Add `entity()` + `entityCache` to `Repository`**

In `src/model/model.ts`:

1. Add the value import near the `ReactiveNode` import (around line 22):

```ts
import { EntityBase, type Entity } from "./entity.js";
```

2. Add a private field to `class Repository` (next to the other private fields, around line 53):

```ts
  private readonly entityCache = new Map<NodeId, EntityBase>();
```

3. Add the method immediately after `view(id)` (around line 94):

```ts
  /**
   * A memoized read lens for `id` (spec §4). Same id → same instance (identity
   * map), so references resolve to shared handles and cycles are safe. Undefined
   * when the node does not exist.
   */
  entity<T extends Entity = Entity>(id: NodeId): T | undefined {
    if (!this.has(id)) return undefined;
    let handle = this.entityCache.get(id);
    if (handle === undefined) {
      handle = new EntityBase(this, id);
      this.entityCache.set(id, handle);
    }
    return handle as unknown as T;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/entity.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: whole suite green; `tsc --noEmit` clean (the type-only `Repository` import in `entity.ts` and the value import of `EntityBase` in `model.ts` must not produce a runtime cycle — `reactive.ts` proves the pattern).

- [ ] **Step 7: Commit**

```bash
git add src/model/entity.ts src/model/model.ts src/model/tests/entity.test.ts
git commit -m "feat(model): add Entity/EntityBase lens and memoized Repository.entity() identity map

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Public API exports + Component A integration test

**Files:**
- Modify: `src/index.ts` (export `EntityBase` + `Entity` type)
- Test: `src/model/tests/entity-integration.test.ts` (create)

**Interfaces:**
- Consumes: `Repository` (with Task 1 + Task 2 additions), `EntityBase`/`Entity` from `src/model/entity.ts`, `defineTaxonomy` on `Builder`.
- Produces: `Entity` and `EntityBase` on the package public surface (`@pragmatic-lab/todl`), consumed by later phases and by Plexus.

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/entity-integration.test.ts`. This exercises the whole Component A surface end-to-end — a concept, a taxonomy whose term is referenced by an instance, and reads through the `Entity` lens — and asserts the new symbols are exported from the package root:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository, EntityBase, type Entity } from "../../index.js";

// A meta-model-ish graph: concept `component`, taxonomy `component-category`
// (represents component) with term `ai-agent`, and an instance `gw` whose
// reference field `category` points at the term.
function fixture(): Repository {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineTaxonomy("component-category", ["component"], [
    { id: "ai-agent", attrs: new Map([["label", "AI Agent"]]) },
  ]);
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "category", "component-category.ai-agent");
  b.commit();
  return repo;
}

test("Entity and EntityBase are exported from the package root", () => {
  assert.equal(typeof EntityBase, "function");
  const gw: Entity | undefined = fixture().entity("gw");
  assert.ok(gw instanceof EntityBase);
});

test("a reference into a taxonomy term navigates to a class Entity with its fields", () => {
  const repo = fixture();
  const category = repo.entity("gw")!.ref("category")!;
  assert.equal(category.id, "component-category.ai-agent");
  assert.equal(category.field("label"), "AI Agent");
  // The term node is a class of `component`, so is() sees the represented concept.
  assert.equal(category.is("component"), true);
});

test("the whole read surface composes: fields, refs, and reverse navigation", () => {
  const repo = fixture();
  const gw = repo.entity("gw")!;
  assert.equal(gw.field("label"), "Gateway");
  assert.deepEqual(gw.refs("category").map((e) => e.id), ["component-category.ai-agent"]);
  const term = repo.entity("component-category.ai-agent")!;
  assert.deepEqual(term.referrers("category").map((e) => e.id), ["gw"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/entity-integration.test.ts`
Expected: FAIL — the import `{ EntityBase, type Entity } from "../../index.js"` does not resolve (`EntityBase` is not exported).

- [ ] **Step 3: Add the exports**

In `src/index.ts`, after the `Repository` export block (around line 37), add:

```ts
export { EntityBase, type Entity } from "./model/entity.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/entity-integration.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Run the full suite + typecheck + build**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`, then `npm run typecheck`, then `npm run build`
Expected: whole suite green; `tsc --noEmit` clean; `npm run build` produces `dist/` with `dist/model/entity.js` and `dist/model/entity.d.ts` (the new subpath compiles).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/model/tests/entity-integration.test.ts
git commit -m "feat: export Entity/EntityBase from the package root (Component A complete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done-when

- `Repository` exposes `attr`, `ref`, `refs`, `referrers`, `danglingRefs`, and a memoized `entity()`; `Entity`/`EntityBase` are implemented and exported from `@pragmatic-lab/todl`.
- The whole TODL suite is green, `npm run typecheck` is clean, and `npm run build` compiles the new `entity` module.
- No existing behaviour changed; all additions are net-new methods/files.
- Deferred to later phases (do NOT do here): eager frozen hydration + `Object.freeze` + memoized derived queries (Phase 2); the positive-case `danglingRefs()` test via an overlay (Phase 4); typed codegen (Phase 3/5); `GraphStore` seam (Phase 6/7).
