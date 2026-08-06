# Typed Repository Clients — Phase 6: `GraphStore` Seam (Component F, in-memory) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a `GraphStore` interface between `Graph` and its storage — extract the current in-memory maps into an `InMemoryGraphStore`, make `Graph` delegate to a swappable store, and prove the contract with a shared conformance suite — so a graph-DB backend (Phase 7) can drop in behind the same `Repository`/`Graph` API with zero changes above the seam.

**Architecture:** Behavior-preserving refactor. `GraphStore` declares the storage primitives (node/edge lookup, dual adjacency, type index, mutations, `remove`, `commit`). `InMemoryGraphStore` is the current `_nodes`/`_out`/`_in`/`_byType` implementation lifted out verbatim, plus new `remove` and `commit`. `Graph` keeps the `changed` `Signal` and the derived traversals (`related`, `closure`) and delegates all storage to an injected `GraphStore` (default in-memory); its mutators delegate then emit the same `changed` events as today. `Repository` is untouched. A `describeGraphStore(name, make)` conformance suite exercises the contract and runs against `InMemoryGraphStore` now — the same suite backs Phase 7's Cypher store.

**Tech Stack:** TypeScript (ESM, strict), Node's built-in test runner via `tsx`.

## Global Constraints

- **This plan is Phase 6 of 7** (spec §14). Builds Component F's **in-memory refactor** (spec §9). Do NOT build the Cypher/graph-DB store (Phase 7) — only the seam + in-memory impl + conformance suite.
- **Behavior-preserving.** No observable change to `Graph`/`Repository`/`Builder`/loader behaviour: same method signatures, same `changed` events (kind + node + property + target), same validation error messages (`node "X" already exists`, `edge source "X" does not exist`, `edge target "X" does not exist`, `node "X" does not exist`). All 409 existing tests stay green unchanged.
- **The change bus stays on `Graph`.** `GraphStore` is storage-only (no `Signal`); `Graph` emits `changed` after delegating a mutation, computing the edge `property` exactly as today (`Relationship`/`Derived` → `via`, else `null`).
- **The seam is swappable at `Graph` construction:** `new Graph(store?: GraphStore)` defaults to `new InMemoryGraphStore()`. `Repository`'s `new Graph()` default is unchanged.
- **`remove` and `commit` are new** on the store: `remove(id)` deletes a node and detaches its in/out edges (throws `node "X" does not exist` if absent); `commit()` is a no-op in-memory. Nothing above the seam calls them yet — they exist for the interface + conformance + Phase 7.
- **The conformance suite is reusable:** `describeGraphStore(name, make)` takes a store factory and registers `node:test` cases; Phase 7 calls it with a Cypher factory. No in-memory-specific assumptions in the suite.
- **Every test file lives in a `tests/` subfolder.** Use real enums.
- Test: `npx tsx --conditions=development --test "src/**/*.test.ts"`. Typecheck: `npm run typecheck`. Build: `npm run build`.

### Resolved design decisions

1. **`GraphStore` surface** (superset of spec §9, adding what `Graph` needs): `getNode`, `hasNode`, `nodeCount`, `allNodes`, `instancesOf`, `outEdges`, `inEdges`, `addNode`, `addEdge`, `setAttr`, `remove`, `commit`. No `related`/`closure` (those are derived, stay on `Graph`). No `Signal`.
2. **`InMemoryGraphStore` owns the same dual adjacency + type index**; edges are shared objects across `_out[from]` and `_in[to]` (as today), so `remove` detaches by object identity.
3. **`Graph` becomes a thin facade:** a `private readonly store: GraphStore`, the `changed` `Signal`, delegating reads, delegating-then-emitting mutations, and the unchanged `related`/`closure`.
4. **`allNodes(): Node[]`** on the store (not `Iterable<Node>`) to match `Graph.allNodes()`'s current return type exactly.

### File structure

- `src/model/graph-store.ts` *(create)* — `interface GraphStore` + `class InMemoryGraphStore`.
- `src/model/graph.ts` *(modify)* — `Graph` delegates to an injected `GraphStore`; keeps `changed`, `related`, `closure`.
- `src/index.ts` *(modify)* — export `GraphStore` (type) + `InMemoryGraphStore`.
- `src/model/tests/graph-store-conformance.ts` *(create)* — `describeGraphStore(name, make)`.
- `src/model/tests/graph-store.test.ts` *(create)* — runs the suite against `InMemoryGraphStore`.

---

## Task 1: `GraphStore` interface + `InMemoryGraphStore` + conformance suite

**Files:**
- Create: `src/model/graph-store.ts`
- Create: `src/model/tests/graph-store-conformance.ts`
- Create: `src/model/tests/graph-store.test.ts`

**Interfaces:**
- Consumes: `Node`, `Edge`, `NodeId`, `Scalar`, `Tier`, `EdgeKind` from `src/model/graph.js` (these type/enum declarations stay in `graph.ts`).
- Produces: `interface GraphStore`; `class InMemoryGraphStore implements GraphStore`; `function describeGraphStore(name: string, make: () => GraphStore): void`.

- [ ] **Step 1: Write the conformance suite + the failing test that runs it**

Create `src/model/tests/graph-store-conformance.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Tier, EdgeKind, type Node, type Edge, type NodeId } from "../graph.js";
import type { GraphStore } from "../graph-store.js";

function node(id: NodeId, typeOf = "thing"): Node {
  return { id, tier: Tier.Instance, typeOf, attrs: new Map() };
}
function edge(from: NodeId, to: NodeId, via: NodeId | null = "rel"): Edge {
  return { kind: EdgeKind.Relationship, via, from, to };
}

/** Contract every GraphStore backend must satisfy (spec §9). Phase 7 reuses this. */
export function describeGraphStore(name: string, make: () => GraphStore): void {
  test(`${name}: addNode / getNode / hasNode / nodeCount`, () => {
    const s = make();
    assert.equal(s.hasNode("a"), false);
    s.addNode(node("a"));
    assert.equal(s.hasNode("a"), true);
    assert.equal(s.getNode("a")?.id, "a");
    assert.equal(s.nodeCount, 1);
    assert.throws(() => s.addNode(node("a")), /already exists/);
  });

  test(`${name}: instancesOf indexes by typeOf`, () => {
    const s = make();
    s.addNode(node("a", "component"));
    s.addNode(node("b", "component"));
    s.addNode(node("c", "technology"));
    assert.deepEqual([...s.instancesOf("component")].sort(), ["a", "b"]);
    assert.deepEqual([...s.instancesOf("technology")], ["c"]);
    assert.deepEqual([...s.instancesOf("nope")], []);
  });

  test(`${name}: addEdge + outEdges / inEdges`, () => {
    const s = make();
    s.addNode(node("a"));
    s.addNode(node("b"));
    s.addEdge(edge("a", "b"));
    assert.deepEqual(s.outEdges("a").map((e) => e.to), ["b"]);
    assert.deepEqual(s.inEdges("b").map((e) => e.from), ["a"]);
    assert.deepEqual(s.outEdges("b"), []);
  });

  test(`${name}: addEdge throws on a missing endpoint`, () => {
    const s = make();
    s.addNode(node("a"));
    assert.throws(() => s.addEdge(edge("a", "ghost")), /target .*does not exist/);
    assert.throws(() => s.addEdge(edge("ghost", "a")), /source .*does not exist/);
  });

  test(`${name}: setAttr sets a scalar (throws for a missing node)`, () => {
    const s = make();
    s.addNode(node("a"));
    s.setAttr("a", "label", "A");
    assert.equal(s.getNode("a")?.attrs.get("label"), "A");
    assert.throws(() => s.setAttr("ghost", "x", 1), /does not exist/);
  });

  test(`${name}: remove deletes the node, its edges, and its type-index entry`, () => {
    const s = make();
    s.addNode(node("a", "component"));
    s.addNode(node("b"));
    s.addEdge(edge("a", "b"));
    s.addEdge(edge("b", "a"));
    s.remove("a");
    assert.equal(s.hasNode("a"), false);
    assert.deepEqual([...s.instancesOf("component")], []);
    assert.deepEqual(s.inEdges("b"), []); // a->b detached
    assert.deepEqual(s.outEdges("b"), []); // b->a detached
    assert.throws(() => s.remove("a"), /does not exist/);
  });

  test(`${name}: allNodes returns every node; commit is callable`, () => {
    const s = make();
    s.addNode(node("a"));
    s.addNode(node("b"));
    assert.deepEqual([...s.allNodes()].map((n) => n.id).sort(), ["a", "b"]);
    s.commit(); // no throw
  });
}
```

Create `src/model/tests/graph-store.test.ts`:

```ts
import { describeGraphStore } from "./graph-store-conformance.js";
import { InMemoryGraphStore } from "../graph-store.js";

describeGraphStore("InMemoryGraphStore", () => new InMemoryGraphStore());
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/graph-store.test.ts`
Expected: FAIL — cannot resolve `../graph-store.js`.

- [ ] **Step 3: Implement `src/model/graph-store.ts`**

Lift the current storage out of `Graph` (the `_nodes`/`_out`/`_in`/`_byType` maps + `appendEdge`) into `InMemoryGraphStore`, and add `remove`/`commit`:

```ts
/**
 * Storage seam under {@link Graph} (design spec §9). A GraphStore holds nodes,
 * dual edge adjacency, and the type index; it knows nothing of the change bus or
 * derived traversals (those live on Graph). Swapping the store — in-memory here,
 * a graph DB later — leaves the Repository/Graph API unchanged.
 */

import { type Node, type Edge, type NodeId, type Scalar } from "./graph.js";

export interface GraphStore {
  getNode(id: NodeId): Node | undefined;
  hasNode(id: NodeId): boolean;
  readonly nodeCount: number;
  allNodes(): Node[];
  instancesOf(typeOf: NodeId): NodeId[];
  outEdges(id: NodeId): Edge[];
  inEdges(id: NodeId): Edge[];
  addNode(node: Node): void;
  addEdge(edge: Edge): void;
  setAttr(id: NodeId, name: string, value: Scalar): void;
  remove(id: NodeId): void;
  commit(): void;
}

export class InMemoryGraphStore implements GraphStore {
  private readonly _nodes = new Map<NodeId, Node>();
  private readonly _out = new Map<NodeId, Edge[]>();
  private readonly _in = new Map<NodeId, Edge[]>();
  private readonly _byType = new Map<NodeId, Set<NodeId>>();

  getNode(id: NodeId): Node | undefined {
    return this._nodes.get(id);
  }

  hasNode(id: NodeId): boolean {
    return this._nodes.has(id);
  }

  get nodeCount(): number {
    return this._nodes.size;
  }

  allNodes(): Node[] {
    return [...this._nodes.values()];
  }

  instancesOf(typeOf: NodeId): NodeId[] {
    const bucket = this._byType.get(typeOf);
    return bucket === undefined ? [] : [...bucket];
  }

  outEdges(id: NodeId): Edge[] {
    return this._out.get(id) ?? [];
  }

  inEdges(id: NodeId): Edge[] {
    return this._in.get(id) ?? [];
  }

  addNode(node: Node): void {
    if (this._nodes.has(node.id)) {
      throw new Error(`node "${node.id}" already exists`);
    }
    this._nodes.set(node.id, node);
    let bucket = this._byType.get(node.typeOf);
    if (bucket === undefined) {
      bucket = new Set<NodeId>();
      this._byType.set(node.typeOf, bucket);
    }
    bucket.add(node.id);
  }

  addEdge(edge: Edge): void {
    if (!this._nodes.has(edge.from)) {
      throw new Error(`edge source "${edge.from}" does not exist`);
    }
    if (!this._nodes.has(edge.to)) {
      throw new Error(`edge target "${edge.to}" does not exist`);
    }
    appendEdge(this._out, edge.from, edge);
    appendEdge(this._in, edge.to, edge);
  }

  setAttr(id: NodeId, name: string, value: Scalar): void {
    const node = this._nodes.get(id);
    if (node === undefined) {
      throw new Error(`node "${id}" does not exist`);
    }
    node.attrs.set(name, value);
  }

  remove(id: NodeId): void {
    const node = this._nodes.get(id);
    if (node === undefined) {
      throw new Error(`node "${id}" does not exist`);
    }
    for (const e of this._out.get(id) ?? []) {
      const rev = this._in.get(e.to);
      if (rev !== undefined) this._in.set(e.to, rev.filter((x) => x !== e));
    }
    for (const e of this._in.get(id) ?? []) {
      const fwd = this._out.get(e.from);
      if (fwd !== undefined) this._out.set(e.from, fwd.filter((x) => x !== e));
    }
    this._out.delete(id);
    this._in.delete(id);
    const bucket = this._byType.get(node.typeOf);
    if (bucket !== undefined) {
      bucket.delete(id);
      if (bucket.size === 0) this._byType.delete(node.typeOf);
    }
    this._nodes.delete(id);
  }

  commit(): void {
    // in-memory: writes are already applied
  }
}

function appendEdge(index: Map<NodeId, Edge[]>, key: NodeId, edge: Edge): void {
  const list = index.get(key);
  if (list === undefined) {
    index.set(key, [edge]);
  } else {
    list.push(edge);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/graph-store.test.ts`
Expected: PASS (7 conformance cases).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: green (nothing else changed yet — `graph.ts` still owns its own maps); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/model/graph-store.ts src/model/tests/graph-store-conformance.ts src/model/tests/graph-store.test.ts
git commit -m "feat(model): GraphStore seam + InMemoryGraphStore + shared conformance suite

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `Graph` delegates to a `GraphStore` + exports

**Files:**
- Modify: `src/model/graph.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `GraphStore`, `InMemoryGraphStore` (Task 1).
- Produces: `Graph` with `constructor(store?: GraphStore)` delegating storage; exports `GraphStore`/`InMemoryGraphStore`.

- [ ] **Step 1: Refactor `Graph` to delegate (behavior-preserving — existing tests are the gate)**

In `src/model/graph.ts`, replace the `Graph` class body (keep the enums, `Node`, `Edge`, `GraphChangeArgs`, `GraphChangeKind`, and the module `appendEdge` may be deleted since it moved to the store). The class keeps `changed`, `related`, `closure`; everything else delegates:

```ts
import { InMemoryGraphStore, type GraphStore } from "./graph-store.js";

export class Graph {
  private readonly store: GraphStore;

  /** The mutation event bus (spec §R2): one event per applied change. */
  readonly changed = new Signal<GraphChangeArgs>();

  constructor(store: GraphStore = new InMemoryGraphStore()) {
    this.store = store;
  }

  addNode(node: Node): void {
    this.store.addNode(node);
    this.changed.emit({ kind: GraphChangeKind.NodeAdded, node: node.id, property: null, target: null });
  }

  getNode(id: NodeId): Node | undefined {
    return this.store.getNode(id);
  }

  hasNode(id: NodeId): boolean {
    return this.store.hasNode(id);
  }

  get nodeCount(): number {
    return this.store.nodeCount;
  }

  allNodes(): Node[] {
    return this.store.allNodes();
  }

  instancesOf(concept: NodeId): NodeId[] {
    return this.store.instancesOf(concept);
  }

  addEdge(edge: Edge): void {
    this.store.addEdge(edge);
    const property =
      edge.kind === EdgeKind.Relationship || edge.kind === EdgeKind.Derived ? edge.via : null;
    this.changed.emit({ kind: GraphChangeKind.EdgeAdded, node: edge.from, property, target: edge.to });
  }

  setAttr(id: NodeId, name: string, value: Scalar): void {
    this.store.setAttr(id, name, value);
    this.changed.emit({ kind: GraphChangeKind.AttrSet, node: id, property: name, target: null });
  }

  outEdges(id: NodeId): Edge[] {
    return this.store.outEdges(id);
  }

  inEdges(id: NodeId): Edge[] {
    return this.store.inEdges(id);
  }

  related(id: NodeId, kind: EdgeKind, direction: Direction, via: NodeId | null = null): NodeId[] {
    // unchanged body (uses this.outEdges / this.inEdges)
  }

  closure(
    start: NodeId,
    kind: EdgeKind,
    direction: Direction,
    reflexive: boolean,
    via: NodeId | null = null,
  ): NodeId[] {
    // unchanged body
  }
}
```

Keep the existing `related` and `closure` bodies verbatim (they already call `this.outEdges`/`this.inEdges`/`this.related`). Delete the old private map fields and the module-level `appendEdge` (now in the store). Keep the `import { Signal } from "../core/signal.js";` import.

- [ ] **Step 2: Run the full suite to verify no regression**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`
Expected: all 409+ tests green — `Graph`/`Repository`/`Builder`/loader behaviour is unchanged; `changed` events fire identically.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. (If `Scalar` is now unused in `graph.ts`, it is still used by `setAttr`'s signature — keep the import.)

- [ ] **Step 4: Add exports**

In `src/index.ts`, in the graph export area, add:

```ts
export { InMemoryGraphStore, type GraphStore } from "./model/graph-store.js";
```

- [ ] **Step 5: Full suite + typecheck + build**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`, then `npm run typecheck`, then `npm run build`
Expected: green; typecheck clean; build exits 0 and emits `dist/model/graph-store.js`.

- [ ] **Step 6: Commit**

```bash
git add src/model/graph.ts src/index.ts
git commit -m "refactor(model): Graph delegates storage to a swappable GraphStore (Component F in-memory complete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done-when

- `GraphStore` abstracts `Graph`'s storage; `InMemoryGraphStore` passes a shared `describeGraphStore` conformance suite (including `remove` and `commit`); `Graph` delegates all storage to an injected store (default in-memory) while keeping the `changed` bus and `related`/`closure`.
- `new Graph(store)` accepts any `GraphStore`; `GraphStore`/`InMemoryGraphStore` are exported.
- No behaviour change: all existing tests green, `changed` events and error messages identical; typecheck clean; build emits the new module.
- Deferred (Phase 7): a Cypher/graph-DB `GraphStore` implementation passing the same conformance suite; wiring `remove` up through `Repository`/`ModelDraft`.
