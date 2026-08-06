# Typed Repository Clients — Phase 4: `ModelDraft` Overlay (Component D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ModelDraft` — a mutable authoring overlay over frozen bases (a meta-model + libraries) where a user builds a model by adding typed instances whose reference fields point into the frozen bases or at each other; reads resolve across layers, validation runs the overlay against the base vocabulary, and serialization emits only the overlay delta.

**Architecture:** `ModelDraft` composes a single mutable working `Repository` exactly as `checkAgainst` does — `mergeBases([prelude, ...baseDocs])` copies the frozen bases into one `Graph`, then instances are staged on top via the existing `Builder`. Because the base nodes are present in the combined graph, a cross-boundary reference is an ordinary `Relationship` edge whose `to` is a base id; own→own references are identical. The overlay tracks which node ids are base (recorded at `on()`) vs own (added after), so `toJSON()` emits only the own delta (instances + their edges, bases referenced by id, never copied). `diagnostics` is `model.validate()` over the combined graph. Reads (`entity`, `resolve`) delegate to the combined `Repository`, so layered navigation is native.

**Tech Stack:** TypeScript (ESM, strict), Node's built-in test runner via `tsx` (`node:test` + `node:assert/strict`).

## Global Constraints

- **This plan is Phase 4 of 7** (spec §14). Builds Component D (spec §7) as an **MVP** on the in-memory store. Do NOT build authoring-constructor codegen (Phase 5), the `GraphStore` seam (Phase 6), or Cypher (Phase 7).
- **In scope:** `ModelDraft.on`, `add(descriptor)` (scalars + refs, cross-boundary + own→own), layered reads, `get diagnostics`, `toJSON()` own-delta, round-trip recompose.
- **Deferred (flagged, not dropped):** `remove` / `transact` / `commit` (in-memory writes are already live; these are GraphStore concerns for Phase 6/7); `toTodl()` text export (TODL has no model-text emitter yet); a `model`-container node + binding header inside the delta (delta is bare own nodes+edges for v1); `danglingRefs()` positive case (`add` requires ref targets to exist, so authoring never dangles — the orphan-on-base-upgrade case waits for reopen/GraphStore work).
- **`add` requires every reference target to already exist** in a base or a previously-added own instance (fail-fast). A missing target throws at `add` (via the `Builder` commit check) — it does not silently drop or create a dangling edge.
- **Reuse, don't reinvent:** compose the working graph with the SAME `mergeBases` + prelude that `checkAgainst` uses (export `mergeBases` from `api.ts`); stage instances with the existing `Builder` (`assertInstance`/`setField`/`addRelationship`); validate with `Repository.validate()`.
- **Additive only.** Exporting `mergeBases` and adding `ModelDraft` touches no existing behaviour; every existing test stays green.
- **Every test file lives in a `tests/` subfolder.** Use real enums, never string-literal unions.
- Test: `npx tsx --conditions=development --test "src/**/*.test.ts"`. Typecheck: `npm run typecheck`. Build: `npm run build`.

### Resolved design decisions

1. **Working model = combined `Repository`.** `on()` builds it via `new Repository(mergeBases([preludeDocument(), ...bases.map(toJSON)]))`. Base ids are recorded into `this.baseIds` immediately (every node then present). Own nodes = anything added afterward.
2. **`InstanceDescriptor` is a plain record** `{ concept: string; id: string; scalars?: ReadonlyMap<string, Scalar>; refs?: ReadonlyMap<string, readonly NodeId[]> }`. Phase 5 codegen will emit these; Phase 4 accepts them directly. `scalars`→attrs, `refs`→`Relationship` edges (one per target).
3. **Bases are `Repository[]`** (a `FrozenRepository` is one). `on()` serializes each with `toJSON(base)` and merges. (Re-serializing is acceptable for the MVP; a zero-copy path is a later optimization.)
4. **Reads delegate to the combined model.** `entity(id)`/`resolve(id)`/`has(id)` forward to `this.model`; layered resolution is native because base+own live in one graph.
5. **`toJSON()` = own delta:** every non-base node + the edges leaving non-base nodes (so cross-boundary edges are kept by target id; base→base edges are excluded). Mirrors `emit/json.ts` `toJSON`, filtered by `baseIds`.
6. **`add` returns the handle** `this.model.entity(id)!` (an `Entity`) for immediate navigation.

### File structure

- `src/api.ts` *(modify)* — `export` the existing `mergeBases`.
- `src/authoring/model-draft.ts` *(create)* — `InstanceDescriptor`, `ModelDraft`.
- `src/index.ts` *(modify)* — export `ModelDraft`, `type InstanceDescriptor`.
- `src/authoring/tests/model-draft.test.ts` *(create)* — Task 1 + Task 2 tests.
- `src/authoring/tests/model-draft-serialize.test.ts` *(create)* — Task 3 tests.

---

## Task 1: `ModelDraft.on` + combined working model + layered reads

**Files:**
- Modify: `src/api.ts` (export `mergeBases`)
- Create: `src/authoring/model-draft.ts`
- Test: `src/authoring/tests/model-draft.test.ts` (create)

**Interfaces:**
- Consumes: `mergeBases(bases: TodlDocument[]): Graph` (now exported); `preludeDocument()` (`src/stdlib/prelude.js`); `toJSON` (`src/emit/json.js`); `Repository`; `Scalar`/`NodeId` (`src/model/graph.js`); `Entity` (`src/model/entity.js`).
- Produces:
  - `interface InstanceDescriptor { concept: string; id: string; scalars?: ReadonlyMap<string, Scalar>; refs?: ReadonlyMap<string, readonly NodeId[]>; }`
  - `class ModelDraft` with `static on(bases: readonly Repository[], opts: { namespace: string }): ModelDraft`, `resolve(id)`, `has(id)`, `entity(id)`, `get model(): Repository`.

- [ ] **Step 1: Write the failing test**

Create `src/authoring/tests/model-draft.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { FrozenRepository } from "../../model/frozen.js";
import { toJSON } from "../../emit/json.js";
import { ModelDraft } from "../model-draft.js";

// A tiny meta-model base: concept `component` with a scalar `label` and a
// reference field `implemented-by : technology`; concept `technology`; plus a
// library instance `copilot` (a technology) to reference across the boundary.
function baseClient(): FrozenRepository {
  const repo = new Repository();
  const b = repo.builder();
  b.definePrimitive("string");
  b.defineConcept("technology");
  b.addField("technology", "label", "string");
  b.defineConcept("component");
  b.addField("component", "label", "string");
  b.addField("component", "implemented-by", "technology", 1 /* Optional */);
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.commit();
  return FrozenRepository.fromJSON(toJSON(repo));
}

test("on() builds a working model that resolves base nodes", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  assert.equal(draft.has("component"), true); // base concept
  assert.equal(draft.has("copilot"), true); // base instance
  assert.equal(draft.entity("copilot")!.field("label"), "Copilot");
  assert.equal(draft.has("nope"), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/authoring/tests/model-draft.test.ts`
Expected: FAIL — cannot resolve `../model-draft.js`.

- [ ] **Step 3: Export `mergeBases`**

In `src/api.ts`, change `function mergeBases(` to `export function mergeBases(`.

- [ ] **Step 4: Create `src/authoring/model-draft.ts`**

```ts
/**
 * A mutable authoring overlay over frozen bases (design spec §7, Component D). A
 * user builds a model by adding typed instances whose reference fields point into
 * the frozen bases (cross-boundary) or at each other. The overlay composes ONE
 * working Repository exactly as `checkAgainst` does — bases merged into a graph,
 * instances staged on top via the Builder — so cross-boundary references are
 * ordinary edges into present base nodes. Only ids added after `on()` are "own";
 * `toJSON()` emits just that delta.
 */

import { type NodeId, type Scalar, type Node } from "../model/graph.js";
import { Repository } from "../model/model.js";
import { type Entity } from "../model/entity.js";
import { toJSON, type TodlDocument } from "../emit/json.js";
import { mergeBases } from "../api.js";
import { preludeDocument } from "../stdlib/prelude.js";

/** A plain instance record; Phase 5 codegen emits these, Phase 4 accepts them. */
export interface InstanceDescriptor {
  concept: string;
  id: string;
  scalars?: ReadonlyMap<string, Scalar>;
  refs?: ReadonlyMap<string, readonly NodeId[]>;
}

export class ModelDraft {
  private readonly baseIds: ReadonlySet<NodeId>;

  private constructor(
    readonly model: Repository,
    readonly namespace: string,
  ) {
    this.baseIds = new Set(model.allNodes().map((n) => n.id));
  }

  /** Open a draft over the given frozen bases (meta-model + libraries). */
  static on(bases: readonly Repository[], opts: { namespace: string }): ModelDraft {
    const graph = mergeBases([preludeDocument(), ...bases.map((b) => toJSON(b))]);
    return new ModelDraft(new Repository(graph), opts.namespace);
  }

  resolve(id: NodeId): Node | undefined {
    return this.model.resolve(id);
  }

  has(id: NodeId): boolean {
    return this.model.has(id);
  }

  entity(id: NodeId): Entity | undefined {
    return this.model.entity(id);
  }

  /** True when `id` is base (frozen), false when it is an own overlay instance. */
  protected isBase(id: NodeId): boolean {
    return this.baseIds.has(id);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/authoring/tests/model-draft.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: whole suite green; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/api.ts src/authoring/model-draft.ts src/authoring/tests/model-draft.test.ts
git commit -m "feat(authoring): ModelDraft.on — combined working model over frozen bases

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `add` (scalars + cross-boundary/own refs) + `diagnostics`

**Files:**
- Modify: `src/authoring/model-draft.ts` (add `add`, `ownInstances`, `get diagnostics`)
- Test: `src/authoring/tests/model-draft.test.ts` (append)

**Interfaces:**
- Consumes: `Repository.builder()` (`assertInstance`/`setField`/`addRelationship`/`commit`), `Repository.validate()`, `instancesOf`, `isClass`.
- Produces:
  - `add(descriptor: InstanceDescriptor): Entity`
  - `ownInstances(): Entity[]`
  - `get diagnostics(): Diagnostic[]`

- [ ] **Step 1: Write the failing test**

Append to `src/authoring/tests/model-draft.test.ts`:

```ts
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

test("add stages an instance with a scalar and a cross-boundary reference", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  const gw = draft.add({
    concept: "component",
    id: "gw",
    scalars: new Map([["label", "Gateway"]]),
    refs: new Map([["implemented-by", ["copilot"]]]),
  });
  assert.equal(gw.field("label"), "Gateway");
  // the reference resolves across the boundary to the frozen base instance
  assert.equal(gw.ref("implemented-by")!.id, "copilot");
  assert.equal(gw.ref("implemented-by"), draft.entity("copilot"));
});

test("add supports own->own references", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  draft.add({ concept: "technology", id: "custom", scalars: new Map([["label", "Custom"]]) });
  const gw = draft.add({
    concept: "component",
    id: "gw",
    refs: new Map([["implemented-by", ["custom"]]]),
  });
  assert.equal(gw.ref("implemented-by")!.id, "custom");
});

test("ownInstances lists only overlay instances, not base nodes", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  draft.add({ concept: "component", id: "gw", scalars: new Map([["label", "Gateway"]]) });
  assert.deepEqual(draft.ownInstances().map((e) => e.id), ["gw"]);
});

test("diagnostics is clean for a valid overlay", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  draft.add({
    concept: "component",
    id: "gw",
    scalars: new Map([["label", "Gateway"]]),
    refs: new Map([["implemented-by", ["copilot"]]]),
  });
  assert.deepEqual(draft.diagnostics, []);
});

test("add throws when a reference target does not exist (fail-fast, no dangling)", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  assert.throws(
    () => draft.add({ concept: "component", id: "gw", refs: new Map([["implemented-by", ["ghost"]]]) }),
    /ghost/,
  );
});
```

> Note: `DiagnosticCode` is imported to keep the door open for asserting a specific code; the clean-overlay test only needs `[]`. If `add`'s validation surfaces base-level diagnostics, filter them out in `diagnostics` (see Step 2) — the draft reports diagnostics for OWN instances.

- [ ] **Step 2: Implement `add`, `ownInstances`, `diagnostics`**

Add to `src/authoring/model-draft.ts` (and add `import type { Diagnostic } from "../diagnostics/diagnostic.js";`):

```ts
  /** Stage an instance (attrs + reference edges) into the overlay; return its handle. */
  add(descriptor: InstanceDescriptor): Entity {
    const builder = this.model.builder();
    builder.assertInstance(descriptor.concept, descriptor.id);
    for (const [name, value] of descriptor.scalars ?? []) builder.setField(descriptor.id, name, value);
    for (const [member, targets] of descriptor.refs ?? []) {
      for (const target of targets) builder.addRelationship(descriptor.id, member, target);
    }
    builder.commit(); // throws if a reference target does not exist (fail-fast)
    return this.model.entity(descriptor.id)!;
  }

  /** The overlay's own instances (excludes all base nodes). */
  ownInstances(): Entity[] {
    return this.model
      .allNodes()
      .filter((n) => !this.isBase(n.id))
      .map((n) => this.model.entity(n.id)!);
  }

  /** Validate the overlay against the frozen bases (the vocabulary). */
  get diagnostics(): Diagnostic[] {
    return this.model.validate();
  }
```

- [ ] **Step 3: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/authoring/tests/model-draft.test.ts`
Expected: PASS (all tests). If the clean-overlay test reports base-originating diagnostics, scope `diagnostics` to own instances — but a valid base + valid add should already be clean; investigate before filtering.

- [ ] **Step 4: Full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: green; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/authoring/model-draft.ts src/authoring/tests/model-draft.test.ts
git commit -m "feat(authoring): ModelDraft.add (scalars + cross-boundary/own refs) + diagnostics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `toJSON()` own-delta + round-trip recompose + exports

**Files:**
- Modify: `src/authoring/model-draft.ts` (add `toJSON`)
- Modify: `src/index.ts` (export `ModelDraft`, `type InstanceDescriptor`)
- Test: `src/authoring/tests/model-draft-serialize.test.ts` (create)

**Interfaces:**
- Consumes: `Tier`/`EdgeKind` (for JSON member-name encoding, mirroring `emit/json.ts`); `mergeBases` for the recompose check.
- Produces: `toJSON(): TodlDocument` — own nodes + edges leaving own nodes; `ModelDraft`/`InstanceDescriptor` on the package root.

- [ ] **Step 1: Write the failing test**

Create `src/authoring/tests/model-draft-serialize.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { FrozenRepository } from "../../model/frozen.js";
import { toJSON } from "../../emit/json.js";
import { mergeBases } from "../../api.js";
import { ModelDraft, type InstanceDescriptor } from "../../index.js";

function baseClient(): FrozenRepository {
  const repo = new Repository();
  const b = repo.builder();
  b.definePrimitive("string");
  b.defineConcept("technology");
  b.addField("technology", "label", "string");
  b.defineConcept("component");
  b.addField("component", "label", "string");
  b.addField("component", "implemented-by", "technology", 1 /* Optional */);
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.commit();
  return FrozenRepository.fromJSON(toJSON(repo));
}

function draftWithGw() {
  const base = baseClient();
  const draft = ModelDraft.on([base], { namespace: "app" });
  draft.add({
    concept: "component",
    id: "gw",
    scalars: new Map([["label", "Gateway"]]),
    refs: new Map([["implemented-by", ["copilot"]]]),
  });
  return { base, draft };
}

test("toJSON emits only the own delta — base nodes are not copied in", () => {
  const { draft } = draftWithGw();
  const delta = draft.toJSON();
  assert.deepEqual(delta.nodes.map((n) => n.id), ["gw"]);
  assert.equal(delta.nodes.find((n) => n.id === "copilot"), undefined);
});

test("the delta records the cross-boundary edge by target id", () => {
  const { draft } = draftWithGw();
  const delta = draft.toJSON();
  const edge = delta.edges.find((e) => e.from === "gw" && e.via === "implemented-by");
  assert.ok(edge);
  assert.equal(edge!.to, "copilot"); // frozen base id, referenced not copied
});

test("delta + base recompose into the full model", () => {
  const { base, draft } = draftWithGw();
  const recomposed = new Repository(mergeBases([toJSON(base), draft.toJSON()]));
  assert.equal(recomposed.entity("gw")!.field("label"), "Gateway");
  assert.equal(recomposed.entity("gw")!.ref("implemented-by")!.id, "copilot");
});

// InstanceDescriptor is usable as a type from the package root.
const _descriptor: InstanceDescriptor = { concept: "component", id: "x" };
void _descriptor;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/authoring/tests/model-draft-serialize.test.ts`
Expected: FAIL — `ModelDraft`/`InstanceDescriptor` not exported from `../../index.js` (and `toJSON` method missing).

- [ ] **Step 3: Implement `toJSON` + add exports**

Add to `src/authoring/model-draft.ts` (add `Tier`, `EdgeKind` to the graph import):

```ts
  /** Serialize ONLY the overlay delta: own instances + the edges leaving them.
   *  Cross-boundary edges are kept by target id; frozen bases are never copied. */
  toJSON(): TodlDocument {
    const nodes: TodlDocument["nodes"] = [];
    const edges: TodlDocument["edges"] = [];
    for (const node of this.model.allNodes()) {
      if (this.isBase(node.id)) continue;
      nodes.push({
        id: node.id,
        tier: Tier[node.tier],
        typeOf: node.typeOf,
        attrs: Object.fromEntries(node.attrs),
      });
      for (const edge of this.model.outEdges(node.id)) {
        edges.push({ kind: EdgeKind[edge.kind], via: edge.via, from: edge.from, to: edge.to });
      }
    }
    return { nodes, edges };
  }
```

In `src/index.ts`, after the codegen export, add:

```ts
export { ModelDraft, type InstanceDescriptor } from "./authoring/model-draft.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/authoring/tests/model-draft-serialize.test.ts`
Expected: PASS (3 tests + the type usage compiles).

- [ ] **Step 5: Full suite + typecheck + build**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`, then `npm run typecheck`, then `npm run build`
Expected: whole suite green; typecheck clean; build exits 0 and emits `dist/authoring/model-draft.js`.

- [ ] **Step 6: Commit**

```bash
git add src/authoring/model-draft.ts src/index.ts src/authoring/tests/model-draft-serialize.test.ts
git commit -m "feat(authoring): ModelDraft.toJSON own-delta + exports (Component D MVP complete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done-when

- `ModelDraft.on(bases, {namespace})` opens a working model over frozen bases; `add(descriptor)` stages typed instances with scalars and references (cross-boundary into bases AND own→own), returning a navigable handle; `diagnostics` validates the overlay; `toJSON()` emits only the own delta (bases by id), which recomposes with the bases into the full model.
- `ModelDraft` + `InstanceDescriptor` exported; whole suite green, typecheck clean, build emits the new `authoring` module.
- Additive: exporting `mergeBases` + adding `ModelDraft` changed no existing behaviour.
- Deferred (do NOT do here): `remove`/`transact`/`commit`, `toTodl()` text, `model`-container + binding header in the delta, `danglingRefs()` positive case (base-upgrade orphaning); typed authoring constructors (Phase 5); `GraphStore` seam + Cypher (Phase 6/7).
