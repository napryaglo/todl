# Typed Repository Clients — Phase 2: Frozen Hydration (Component B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `FrozenRepository` — a `Repository` loaded from a compiled `TodlDocument`, structurally immutable (mutation sealed) with a memoized read path — so an immutable published base (meta-model / library) answers reads once and forever, with reference handles shared and cycles safe; validated by a hand-written typed client that demonstrates the Component C shape before any codegen exists.

**Architecture:** `FrozenRepository extends Repository` (Phase 1). It reuses the existing lazy `EntityBase` lens and the memoized `entity()` identity map — **one `Entity` implementation** (the approach chosen over spec §5's self-contained eager handles; §5 itself calls eager-vs-lazy "a size tradeoff, not a correctness one", and §11 wants "lenses over the one graph"). Immutability is delivered three ways: `builder()` throws (the only mutation entry point), so the underlying `Graph` never changes; the derived-query methods on the hot read path are memoized (safe forever because the source can't change); and every entity handle is `Object.freeze`d at load. `fromJSON` builds the graph via a shared `graphFromJSON` helper, then eagerly warms + freezes all handles.

**Tech Stack:** TypeScript (ESM, strict tsconfig with `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), Node's built-in test runner via `tsx` (`node:test` + `node:assert/strict`).

## Global Constraints

- **This plan is Phase 2 of 7** from the spec `docs/superpowers/specs/2026-08-06-typed-repository-clients-and-authoring-design.md` §14. Build **only** Component B (spec §5). Do NOT build read-client codegen (Phase 3), `ModelDraft` (Phase 4), authoring codegen (Phase 5), or the `GraphStore` seam (Phase 6/7).
- **Chosen realization: seal + memoize, reuse `EntityBase`** (confirmed 2026-08-06). Do NOT introduce a second `Entity` implementation / self-contained `FrozenEntity`.
- **Additive only.** Phase 1's `Repository`/`Entity`/`EntityBase` and the existing engine are unchanged in behaviour; every existing test stays green. The only refactor is extracting `graphFromJSON` out of the existing `fromJSON` (behaviour-preserving).
- **Immutability is exploited, not just asserted** (spec §5): memoize the derived queries the read path uses; a mutation attempt (`builder()`) throws; handles are `Object.freeze`d.
- **Absence is `undefined`, never a throw** — same as Phase 1.
- **Collections returned from memoized queries are a readonly contract.** They are typed as before (`Map`/array) but callers must not mutate them; ref-target arrays are `Object.freeze`d at cache time as cheap real protection. (Deep Map immutability is not enforceable in JS and is out of scope.)
- **Every test file lives in a `tests/` subfolder** next to its source. Use real enums, never string-literal unions.
- Test command: `npx tsx --conditions=development --test "src/**/*.test.ts"`. Typecheck: `npm run typecheck`. Build: `npm run build`.

### Resolved design decisions (read before starting)

1. **`FrozenRepository` extends `Repository`.** It inherits every read method (incl. Phase 1's `attr`/`ref`/`refs`/`entity`). Because those base methods call `this.effectiveFields`/`this.effectiveRelationships`/`this.supertypesOf`, overriding those in `FrozenRepository` gives the whole read path memoization by polymorphism — no need to override `attr`/`ref`/`refs` themselves.
2. **Sealing = `builder()` throws.** `builder()` is the sole mutation entry point on `Repository`; overriding it to throw makes the instance immutable without touching `Graph`. `changed` never fires.
3. **Memoize exactly the five derived queries the read path uses:** `effectiveFields`, `effectiveRelationships`, `effectiveSchema`, `supertypesOf`, `subtypesOf`. Each gets a private per-key `Map` cache; the override returns the cached value (never recomputing). This covers `attr`/`field`/`fields`, `ref`/`refs`, `schema()`, and `is()`.
4. **Handles are frozen** at load: `fromJSON` calls `Object.freeze(this.entity(id))` for every node, which also pre-warms the identity-map cache (shared instances). Freezing an `EntityBase` (holds `repo` + `id`) is harmless — its reads still work through the repo.
5. **`fromJSON` shares graph-building with the existing `fromJSON`** via a new `graphFromJSON(doc): Graph` in `src/emit/json.ts`; the free `fromJSON` becomes `new Repository(graphFromJSON(doc))`. Behaviour-preserving; existing json round-trip tests must stay green.
6. **The hand-written client is a validation artifact, kept in the test** (not shipped source): a `TechCatalog extends FrozenRepository` with a collection accessor (`get technologies(): Entity[]`) proving the Component C package-class shape works over `FrozenRepository`.

### File structure

- `src/emit/json.ts` *(modify)* — extract `graphFromJSON(doc): Graph`; `fromJSON` delegates to it. New export `graphFromJSON`.
- `src/model/frozen.ts` *(create)* — `FrozenRepository extends Repository`: `static fromJSON`, `builder()` throw, five memoized overrides.
- `src/index.ts` *(modify)* — export `FrozenRepository` and `graphFromJSON`.
- `src/model/tests/frozen.test.ts` *(create)* — Task 1 + Task 3 tests.
- `src/model/tests/frozen-memoization.test.ts` *(create)* — Task 2 tests.

---

## Task 1: `graphFromJSON` extraction + `FrozenRepository` (seal, load, frozen handles)

**Files:**
- Modify: `src/emit/json.ts` (extract `graphFromJSON`)
- Create: `src/model/frozen.ts`
- Test: `src/model/tests/frozen.test.ts` (create)

**Interfaces:**
- Consumes: `fromJSON`/`toJSON`/`TodlDocument` (existing, `src/emit/json.ts`); `Graph` (`src/model/graph.js`); `Repository` (with Phase 1 additions); `EntityBase`/`Entity` (`src/model/entity.js`); `Builder` type (`src/model/builder.js`).
- Produces:
  - `graphFromJSON(doc: TodlDocument): Graph` (exported from `src/emit/json.ts`)
  - `class FrozenRepository extends Repository` with `static fromJSON(doc: TodlDocument): FrozenRepository` and `builder(): never`.

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/frozen.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { toJSON } from "../../emit/json.js";
import { FrozenRepository } from "../frozen.js";

// Build a small graph with the mutable Repository, serialize it, and reload it
// frozen. gw --implemented-by--> copilot; a <-> b via `peer` (a cycle).
function doc() {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("technology");
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "implemented-by", "copilot");
  b.assertInstance("component", "a");
  b.assertInstance("component", "b");
  b.addRelationship("a", "peer", "b");
  b.addRelationship("b", "peer", "a");
  b.commit();
  return toJSON(repo);
}

test("FrozenRepository reads scalars and references like a Repository", () => {
  const frozen = FrozenRepository.fromJSON(doc());
  assert.equal(frozen.attr("gw", "label"), "Gateway");
  assert.equal(frozen.ref("gw", "implemented-by"), "copilot");
  assert.equal(frozen.entity("gw")!.ref("implemented-by")!.id, "copilot");
});

test("entity handles are shared (identity map) and cycle-safe", () => {
  const frozen = FrozenRepository.fromJSON(doc());
  assert.equal(frozen.entity("gw"), frozen.entity("gw"));
  assert.equal(frozen.entity("gw")!.ref("implemented-by"), frozen.entity("copilot"));
  const a = frozen.entity("a")!;
  assert.equal(a.ref("peer")!.ref("peer"), a);
});

test("mutation is sealed: builder() throws", () => {
  const frozen = FrozenRepository.fromJSON(doc());
  assert.throws(() => frozen.builder(), /immutable/);
});

test("entity handles are frozen", () => {
  const frozen = FrozenRepository.fromJSON(doc());
  assert.equal(Object.isFrozen(frozen.entity("gw")), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/frozen.test.ts`
Expected: FAIL — cannot resolve `../frozen.js` (module does not exist).

- [ ] **Step 3: Extract `graphFromJSON` in `src/emit/json.ts`**

Replace the existing `fromJSON` function (lines ~49-70) with an extracted graph builder plus a thin `fromJSON`:

```ts
export function graphFromJSON(doc: TodlDocument): Graph {
  const graph = new Graph();

  for (const node of doc.nodes) {
    graph.addNode({
      id: node.id,
      tier: Tier[node.tier as keyof typeof Tier],
      typeOf: node.typeOf,
      attrs: new Map(Object.entries(node.attrs)),
    });
  }
  for (const edge of doc.edges) {
    graph.addEdge({
      kind: EdgeKind[edge.kind as keyof typeof EdgeKind],
      via: edge.via,
      from: edge.from,
      to: edge.to,
    });
  }

  return graph;
}

export function fromJSON(doc: TodlDocument): Repository {
  return new Repository(graphFromJSON(doc));
}
```

- [ ] **Step 4: Create `src/model/frozen.ts`**

```ts
/**
 * A structurally-immutable {@link Repository} loaded from a compiled
 * {@link TodlDocument} (design spec §5, Component B). A published meta-model or
 * library never changes, so this seals mutation, memoizes the read path forever,
 * and freezes every entity handle. Reuses Phase 1's lazy {@link EntityBase} lens
 * and the memoized `entity()` identity map — one Entity implementation, lenses
 * over the one (now frozen) graph.
 */

import { type NodeId, type Scalar } from "./graph.js";
import { Repository, type ConceptSchema } from "./model.js";
import { graphFromJSON, type TodlDocument } from "../emit/json.js";

export class FrozenRepository extends Repository {
  private readonly fieldsCache = new Map<NodeId, Map<string, Scalar>>();
  private readonly relsCache = new Map<NodeId, Map<string, NodeId[]>>();
  private readonly schemaCache = new Map<NodeId, ConceptSchema>();
  private readonly superCache = new Map<NodeId, NodeId[]>();
  private readonly subCache = new Map<NodeId, NodeId[]>();

  /** Load a compiled document as a frozen client: eager identity-map warm + freeze. */
  static fromJSON(doc: TodlDocument): FrozenRepository {
    const frozen = new FrozenRepository(graphFromJSON(doc));
    for (const node of frozen.allNodes()) Object.freeze(frozen.entity(node.id));
    return frozen;
  }

  /** Immutable: there is no mutation path on a compiled artifact. */
  override builder(): never {
    throw new Error("FrozenRepository is immutable — load a fresh document to change it");
  }

  override effectiveFields(leaf: NodeId): Map<string, Scalar> {
    let value = this.fieldsCache.get(leaf);
    if (value === undefined) {
      value = super.effectiveFields(leaf);
      this.fieldsCache.set(leaf, value);
    }
    return value;
  }

  override effectiveRelationships(leaf: NodeId): Map<string, NodeId[]> {
    let value = this.relsCache.get(leaf);
    if (value === undefined) {
      value = super.effectiveRelationships(leaf);
      for (const targets of value.values()) Object.freeze(targets);
      this.relsCache.set(leaf, value);
    }
    return value;
  }

  override effectiveSchema(concept: NodeId): ConceptSchema {
    let value = this.schemaCache.get(concept);
    if (value === undefined) {
      value = super.effectiveSchema(concept);
      this.schemaCache.set(concept, value);
    }
    return value;
  }

  override supertypesOf(concept: NodeId): NodeId[] {
    let value = this.superCache.get(concept);
    if (value === undefined) {
      value = super.supertypesOf(concept);
      this.superCache.set(concept, value);
    }
    return value;
  }

  override subtypesOf(concept: NodeId): NodeId[] {
    let value = this.subCache.get(concept);
    if (value === undefined) {
      value = super.subtypesOf(concept);
      this.subCache.set(concept, value);
    }
    return value;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/frozen.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Run the full suite + typecheck (the `graphFromJSON` refactor must not regress json round-trip)**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: whole suite green; `tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/emit/json.ts src/model/frozen.ts src/model/tests/frozen.test.ts
git commit -m "feat(model): add FrozenRepository (sealed immutable client) + graphFromJSON

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Memoization is exploited — derived queries computed once

**Files:**
- Test: `src/model/tests/frozen-memoization.test.ts` (create)
- (No source change — Task 1 implemented the memoized overrides; this task proves they hold and that correctness is unchanged.)

**Interfaces:**
- Consumes: `FrozenRepository.fromJSON` (Task 1); `Repository` for the parity baseline.

- [ ] **Step 1: Write the failing test**

> Note: the overrides already exist from Task 1, so these tests are expected to PASS immediately. They are a distinct reviewer gate: they lock in the memoization contract (same instance returned; parity with a mutable `Repository`). If any assertion fails, the Task 1 overrides are wrong — fix there.

Create `src/model/tests/frozen-memoization.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { toJSON } from "../../emit/json.js";
import { FrozenRepository } from "../frozen.js";

function build(): Repository {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("app-component", "component");
  b.assertInstance("app-component", "gw");
  b.setField("gw", "label", "Gateway");
  b.commit();
  return repo;
}

test("memoized derived queries return the identical cached instance", () => {
  const frozen = FrozenRepository.fromJSON(toJSON(build()));
  assert.equal(frozen.effectiveFields("gw"), frozen.effectiveFields("gw"));
  assert.equal(frozen.effectiveRelationships("gw"), frozen.effectiveRelationships("gw"));
  assert.equal(frozen.effectiveSchema("app-component"), frozen.effectiveSchema("app-component"));
  assert.equal(frozen.supertypesOf("app-component"), frozen.supertypesOf("app-component"));
  assert.equal(frozen.subtypesOf("component"), frozen.subtypesOf("component"));
});

test("frozen results match a mutable Repository (memoization changes nothing observable)", () => {
  const mutable = build();
  const frozen = FrozenRepository.fromJSON(toJSON(build()));
  assert.deepEqual([...frozen.effectiveFields("gw")], [...mutable.effectiveFields("gw")]);
  assert.deepEqual(frozen.supertypesOf("app-component"), mutable.supertypesOf("app-component"));
  assert.equal(frozen.effectiveSchema("app-component").concept, "app-component");
  assert.equal(frozen.entity("gw")!.is("component"), true); // subtype via memoized supertypesOf
});

test("memoized ref-target arrays are frozen (no accidental mutation of the cache)", () => {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("technology");
  b.assertInstance("technology", "copilot");
  b.assertInstance("component", "gw");
  b.addRelationship("gw", "implemented-by", "copilot");
  b.commit();
  const frozen = FrozenRepository.fromJSON(toJSON(repo));
  const targets = frozen.effectiveRelationships("gw").get("implemented-by")!;
  assert.equal(Object.isFrozen(targets), true);
});
```

- [ ] **Step 2: Run the test**

Run: `npx tsx --conditions=development --test src/model/tests/frozen-memoization.test.ts`
Expected: PASS (all 3 tests) — the overrides from Task 1 satisfy them. If any FAIL, fix the corresponding override in `src/model/frozen.ts`.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: whole suite green; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add src/model/tests/frozen-memoization.test.ts
git commit -m "test(model): lock in FrozenRepository memoization + mutable-parity contract

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Hand-written typed client shape + exports

**Files:**
- Modify: `src/index.ts` (export `FrozenRepository`, `graphFromJSON`)
- Test: `src/model/tests/frozen.test.ts` (append the hand-written-client tests)

**Interfaces:**
- Consumes: `FrozenRepository`, `Entity` (Phase 1), `toJSON`.
- Produces: `FrozenRepository` + `graphFromJSON` on the package public surface (`@pragmatic-lab/todl`), consumed by Phase 3 codegen.

- [ ] **Step 1: Write the failing test**

Append to `src/model/tests/frozen.test.ts` (add imports `FrozenRepository`, `Entity` from the package root in a second import line, and a taxonomy to the fixture is not needed — reuse `doc()`):

```ts
// ── Hand-written client shape (validates the Component C shape pre-codegen) ──
import { FrozenRepository as FrozenFromRoot, type Entity } from "../../index.js";

// A hand-written package class: the shape Phase 3 codegen will emit. A collection
// accessor per concept; entity reads via the inherited typed primitives.
class TechCatalog extends FrozenFromRoot {
  get technologies(): Entity[] {
    return this.instancesOf("technology").map((id) => this.entity(id)!);
  }
  get components(): Entity[] {
    return this.instancesOf("component").map((id) => this.entity(id)!);
  }
}

test("FrozenRepository and graphFromJSON are exported from the package root", () => {
  assert.equal(typeof FrozenFromRoot, "function");
});

test("a hand-written client exposes concept collections of typed entities", () => {
  const catalog = TechCatalog.fromJSON(doc()) as TechCatalog;
  assert.deepEqual(catalog.technologies.map((e) => e.id), ["copilot"]);
  assert.equal(catalog.technologies[0]!.field("label"), "Copilot");
  assert.deepEqual(catalog.components.map((e) => e.id).sort(), ["a", "b", "gw"]);
  assert.equal(catalog.entity("gw")!.ref("implemented-by"), catalog.entity("copilot"));
});
```

> Note: `TechCatalog.fromJSON` inherits `FrozenRepository.fromJSON`, which constructs a `FrozenRepository` (not a `TechCatalog`). The test uses `TechCatalog`'s accessors via the returned instance only where the base type suffices; the `as TechCatalog` cast plus calling `.technologies` works because `fromJSON` is inherited but returns a `FrozenRepository` — **verify at Step 2**. If the accessors are not present on the returned instance (because `fromJSON` hard-codes `new FrozenRepository`), change `FrozenRepository.fromJSON` to construct `new this(...)` (polymorphic) so subclasses hydrate as themselves, and re-run.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/frozen.test.ts`
Expected: FAIL — the import `{ FrozenRepository as FrozenFromRoot } from "../../index.js"` does not resolve (`FrozenRepository` not exported). It may also reveal the `new this(...)` issue flagged above.

- [ ] **Step 3: Make `fromJSON` polymorphic and add exports**

In `src/model/frozen.ts`, change the static so subclasses hydrate as themselves:

```ts
  static fromJSON<T extends typeof FrozenRepository>(this: T, doc: TodlDocument): InstanceType<T> {
    const frozen = new this(graphFromJSON(doc)) as InstanceType<T>;
    for (const node of frozen.allNodes()) Object.freeze(frozen.entity(node.id));
    return frozen;
  }
```

In `src/index.ts`, after the `EntityBase` export (added in Phase 1), add:

```ts
export { FrozenRepository } from "./model/frozen.js";
```

and add `graphFromJSON` to the existing json export block:

```ts
export {
  toJSON,
  fromJSON,
  graphFromJSON,
  type TodlDocument,
  type JsonNode,
  type JsonEdge,
} from "./emit/json.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/frozen.test.ts`
Expected: PASS (all 6 tests — the 4 from Task 1 plus these 2).

- [ ] **Step 5: Run the full suite + typecheck + build**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`, then `npm run typecheck`, then `npm run build`
Expected: whole suite green; `tsc --noEmit` clean; `npm run build` exits 0 and emits `dist/model/frozen.js` + `dist/model/frozen.d.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/model/frozen.ts src/index.ts src/model/tests/frozen.test.ts
git commit -m "feat: export FrozenRepository; polymorphic fromJSON; hand-written client shape (Component B complete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done-when

- `FrozenRepository` loads a `TodlDocument`, is immutable (`builder()` throws), memoizes its read path (same-instance returned), freezes handles, and shares reference instances (cycle-safe) — all reusing Phase 1's `EntityBase`.
- A hand-written `TechCatalog` client validates the Component C package-class shape (concept collection accessors + typed entity reads) over `FrozenRepository`; `fromJSON` is polymorphic so subclasses hydrate as themselves.
- `FrozenRepository` + `graphFromJSON` are exported from `@pragmatic-lab/todl`.
- Whole suite green, typecheck clean, build emits the new `frozen` module; no existing behaviour changed (only the behaviour-preserving `graphFromJSON` extraction).
- Deferred to later phases (do NOT do here): generating the client `.ts` from a schema (Phase 3); `ModelDraft` overlay + cross-boundary refs (Phase 4); authoring constructors (Phase 5); the `GraphStore` seam + Cypher (Phase 6/7).
