# Typed Repository Clients — Phase 7: Cypher / Graph-DB `GraphStore` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `CypherGraphStore` — a `GraphStore` backed by a graph database over a small async `CypherSession` seam — so a model's system of record can be a graph DB while the `Repository`/`Graph` API stays unchanged, proven by the same `describeGraphStore` conformance suite plus Cypher-translation and load tests, all against fakes (no live DB required to validate).

**Architecture:** The `GraphStore` contract is synchronous; a database is asynchronous. The reconciliation (spec §9 "commit() flushes a DB transaction", "DB as system of record"): `CypherGraphStore` is a synchronous in-memory **working copy** (an inner `InMemoryGraphStore`) loaded from the DB once; every mutation applies to the working copy AND records the equivalent Cypher op; `async flush(session)` persists the recorded ops to the DB as a batch. TODL owns only the `CypherSession` interface (`run(cypher, params): Promise<CypherRow[]>`) — the concrete neo4j-driver binding is a tiny consumer adapter, so TODL gains no dependency. All behaviour is tested against fake sessions.

**Tech Stack:** TypeScript (ESM, strict), Node's built-in test runner via `tsx`. **No new runtime dependencies** (no graph-DB driver in TODL).

## Global Constraints

- **This plan is Phase 7 of 7** (spec §14) — the final phase. Builds the Cypher/graph-DB implementation of Component F (spec §9).
- **No new dependency, no live DB required.** TODL defines the `CypherSession` seam and tests everything against fakes. A real neo4j-driver adapter is documented as a consumer concern, not shipped/depended-on. Live-DB round-trip validation is explicitly out of scope here (gated on an available DB).
- **`CypherGraphStore` satisfies `GraphStore` synchronously** via an inner `InMemoryGraphStore` (reads delegate; writes apply to the inner copy first — so its validation throws BEFORE any Cypher op is recorded — then record the op). It passes the exact same `describeGraphStore` conformance suite from Phase 6.
- **`commit()` stays the sync checkpoint** (no-op). DB persistence is the explicit `async flush(session)` (because `GraphStore.commit` is sync — a documented reconciliation of the sync interface with async I/O).
- **Deterministic Cypher.** Each mutation maps to one fixed Cypher statement + params (below); tests assert them exactly. Node label `Node`, relationship type `REL`; `tier`/`typeOf` are properties; `EdgeKind`/`via` are relationship properties (matches the spec §9 property-graph mapping, using properties rather than dynamic labels for a stable, testable shape).
- **Additive only.** New files + exports; no change to `GraphStore`, `InMemoryGraphStore`, `Graph`, or any existing behaviour. All 416 existing tests stay green.
- **Every test file lives in a `tests/` subfolder.** Use real enums.
- Test: `npx tsx --conditions=development --test "src/**/*.test.ts"`. Typecheck: `npm run typecheck`. Build: `npm run build`.

### Cypher mapping (fixed strings — tests assert these verbatim)

- **addNode(n):** `CREATE (n:Node {id: $id}) SET n.tier = $tier, n.typeOf = $typeOf, n += $attrs`
  params `{ id, tier: Tier[n.tier], typeOf: n.typeOf, attrs: Object.fromEntries(n.attrs) }`
- **addEdge(e):** `MATCH (a:Node {id: $from}), (b:Node {id: $to}) CREATE (a)-[:REL {kind: $kind, via: $via}]->(b)`
  params `{ from, to, kind: EdgeKind[e.kind], via: e.via }`
- **setAttr(id,name,value):** `MATCH (n:Node {id: $id}) SET n += $delta`
  params `{ id, delta: { [name]: value } }`
- **remove(id):** `MATCH (n:Node {id: $id}) DETACH DELETE n`  params `{ id }`
- **load nodes:** `MATCH (n:Node) RETURN n.id AS id, n.tier AS tier, n.typeOf AS typeOf, properties(n) AS props`
- **load edges:** `MATCH (a:Node)-[r:REL]->(b:Node) RETURN a.id AS from, b.id AS to, r.kind AS kind, r.via AS via`

### File structure

- `src/model/cypher-store.ts` *(create)* — `CypherSession`/`CypherRow`/`CypherOp` types, `CypherGraphStore`.
- `src/index.ts` *(modify)* — export the new types + `CypherGraphStore`.
- `src/model/tests/cypher-store.test.ts` *(create)* — translation + flush + load tests (fake sessions) + conformance run.

---

## Task 1: `CypherSession` seam + `CypherGraphStore` (working copy + Cypher recording + flush)

**Files:**
- Create: `src/model/cypher-store.ts`
- Test: `src/model/tests/cypher-store.test.ts` (create — translation + flush parts)

**Interfaces:**
- Consumes: `GraphStore`, `InMemoryGraphStore` (Phase 6); `Node`, `Edge`, `NodeId`, `Scalar`, `Tier`, `EdgeKind` (`src/model/graph.js`).
- Produces:
  - `type CypherRow = Record<string, unknown>`
  - `interface CypherOp { cypher: string; params: Record<string, unknown>; }`
  - `interface CypherSession { run(cypher: string, params?: Record<string, unknown>): Promise<CypherRow[]>; }`
  - `class CypherGraphStore implements GraphStore` with `pendingCypher(): readonly CypherOp[]` and `flush(session: CypherSession): Promise<void>`.

- [ ] **Step 1: Write the failing test (translation + flush)**

Create `src/model/tests/cypher-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Tier, EdgeKind, type Node, type Edge, type NodeId } from "../graph.js";
import { CypherGraphStore, type CypherSession, type CypherRow, type CypherOp } from "../cypher-store.js";

function node(id: NodeId, typeOf = "thing", attrs: Record<string, string> = {}): Node {
  return { id, tier: Tier.Instance, typeOf, attrs: new Map(Object.entries(attrs)) };
}
function edge(from: NodeId, to: NodeId, via: NodeId | null = "rel"): Edge {
  return { kind: EdgeKind.Relationship, via, from, to };
}

class RecordingSession implements CypherSession {
  readonly calls: CypherOp[] = [];
  async run(cypher: string, params: Record<string, unknown> = {}): Promise<CypherRow[]> {
    this.calls.push({ cypher, params });
    return [];
  }
}

test("mutations record the mapped Cypher ops (applied to the working copy first)", () => {
  const s = new CypherGraphStore();
  s.addNode(node("copilot", "technology", { label: "Copilot" }));
  s.addNode(node("gw", "component"));
  s.addEdge(edge("gw", "copilot", "implemented-by"));
  s.setAttr("gw", "label", "Gateway");
  s.remove("copilot");

  // working copy reflects the writes synchronously
  assert.equal(s.getNode("gw")?.attrs.get("label"), "Gateway");
  assert.equal(s.hasNode("copilot"), false);

  const ops = s.pendingCypher();
  assert.deepEqual(ops[0], {
    cypher: "CREATE (n:Node {id: $id}) SET n.tier = $tier, n.typeOf = $typeOf, n += $attrs",
    params: { id: "copilot", tier: "Instance", typeOf: "technology", attrs: { label: "Copilot" } },
  });
  assert.deepEqual(ops[2], {
    cypher: "MATCH (a:Node {id: $from}), (b:Node {id: $to}) CREATE (a)-[:REL {kind: $kind, via: $via}]->(b)",
    params: { from: "gw", to: "copilot", kind: "Relationship", via: "implemented-by" },
  });
  assert.deepEqual(ops[3], {
    cypher: "MATCH (n:Node {id: $id}) SET n += $delta",
    params: { id: "gw", delta: { label: "Gateway" } },
  });
  assert.deepEqual(ops[4], {
    cypher: "MATCH (n:Node {id: $id}) DETACH DELETE n",
    params: { id: "copilot" },
  });
});

test("a failed mutation records no Cypher op (working-copy validation runs first)", () => {
  const s = new CypherGraphStore();
  s.addNode(node("a"));
  assert.throws(() => s.addEdge(edge("a", "ghost")), /does not exist/);
  assert.throws(() => s.addNode(node("a")), /already exists/);
  assert.equal(s.pendingCypher().length, 1); // only the first addNode
});

test("flush runs every pending op through the session in order, then clears", async () => {
  const s = new CypherGraphStore();
  s.addNode(node("a"));
  s.addNode(node("b"));
  s.addEdge(edge("a", "b"));
  const session = new RecordingSession();
  await s.flush(session);
  assert.deepEqual(session.calls.map((c) => c.cypher[0]), ["C", "C", "M"]); // CREATE, CREATE, MATCH
  assert.equal(session.calls.length, 3);
  assert.equal(s.pendingCypher().length, 0); // cleared after flush
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/cypher-store.test.ts`
Expected: FAIL — cannot resolve `../cypher-store.js`.

- [ ] **Step 3: Implement `src/model/cypher-store.ts`**

```ts
/**
 * A {@link GraphStore} backed by a graph database (design spec §9, Component F).
 * The GraphStore contract is synchronous and a DB is asynchronous, so this is a
 * synchronous in-memory working copy (loaded from the DB once) that records the
 * equivalent Cypher for every mutation; `flush(session)` persists the batch as a
 * DB transaction. TODL owns only the {@link CypherSession} seam — the concrete
 * driver (e.g. neo4j-driver) is a thin consumer adapter, so TODL gains no dep.
 */

import { Tier, EdgeKind, type Node, type Edge, type NodeId, type Scalar } from "./graph.js";
import { InMemoryGraphStore, type GraphStore } from "./graph-store.js";

export type CypherRow = Record<string, unknown>;

export interface CypherOp {
  cypher: string;
  params: Record<string, unknown>;
}

/** The async driver seam. A real adapter wraps neo4j-driver's `session.run`. */
export interface CypherSession {
  run(cypher: string, params?: Record<string, unknown>): Promise<CypherRow[]>;
}

const ADD_NODE = "CREATE (n:Node {id: $id}) SET n.tier = $tier, n.typeOf = $typeOf, n += $attrs";
const ADD_EDGE =
  "MATCH (a:Node {id: $from}), (b:Node {id: $to}) CREATE (a)-[:REL {kind: $kind, via: $via}]->(b)";
const SET_ATTR = "MATCH (n:Node {id: $id}) SET n += $delta";
const REMOVE = "MATCH (n:Node {id: $id}) DETACH DELETE n";
const LOAD_NODES = "MATCH (n:Node) RETURN n.id AS id, n.tier AS tier, n.typeOf AS typeOf, properties(n) AS props";
const LOAD_EDGES = "MATCH (a:Node)-[r:REL]->(b:Node) RETURN a.id AS from, b.id AS to, r.kind AS kind, r.via AS via";

export class CypherGraphStore implements GraphStore {
  private readonly inner: InMemoryGraphStore;
  private readonly pending: CypherOp[] = [];

  constructor(inner: InMemoryGraphStore = new InMemoryGraphStore()) {
    this.inner = inner;
  }

  /** Load the whole graph from the DB into a fresh working copy (spec: reads → MATCH). */
  static async load(session: CypherSession): Promise<CypherGraphStore> {
    const inner = new InMemoryGraphStore();
    for (const row of await session.run(LOAD_NODES)) {
      const props = { ...(row.props as Record<string, Scalar>) };
      delete props.id;
      delete props.tier;
      delete props.typeOf;
      inner.addNode({
        id: row.id as NodeId,
        tier: Tier[row.tier as keyof typeof Tier],
        typeOf: row.typeOf as NodeId,
        attrs: new Map(Object.entries(props)),
      });
    }
    for (const row of await session.run(LOAD_EDGES)) {
      inner.addEdge({
        kind: EdgeKind[row.kind as keyof typeof EdgeKind],
        via: (row.via as NodeId | null) ?? null,
        from: row.from as NodeId,
        to: row.to as NodeId,
      });
    }
    return new CypherGraphStore(inner);
  }

  // ── reads: delegate to the working copy ──────────────────────────────────
  getNode(id: NodeId): Node | undefined {
    return this.inner.getNode(id);
  }
  hasNode(id: NodeId): boolean {
    return this.inner.hasNode(id);
  }
  get nodeCount(): number {
    return this.inner.nodeCount;
  }
  allNodes(): Node[] {
    return this.inner.allNodes();
  }
  instancesOf(typeOf: NodeId): NodeId[] {
    return this.inner.instancesOf(typeOf);
  }
  outEdges(id: NodeId): Edge[] {
    return this.inner.outEdges(id);
  }
  inEdges(id: NodeId): Edge[] {
    return this.inner.inEdges(id);
  }

  // ── writes: apply to the working copy (may throw) THEN record the Cypher ──
  addNode(node: Node): void {
    this.inner.addNode(node);
    this.pending.push({
      cypher: ADD_NODE,
      params: { id: node.id, tier: Tier[node.tier], typeOf: node.typeOf, attrs: Object.fromEntries(node.attrs) },
    });
  }

  addEdge(edge: Edge): void {
    this.inner.addEdge(edge);
    this.pending.push({
      cypher: ADD_EDGE,
      params: { from: edge.from, to: edge.to, kind: EdgeKind[edge.kind], via: edge.via },
    });
  }

  setAttr(id: NodeId, name: string, value: Scalar): void {
    this.inner.setAttr(id, name, value);
    this.pending.push({ cypher: SET_ATTR, params: { id, delta: { [name]: value } } });
  }

  remove(id: NodeId): void {
    this.inner.remove(id);
    this.pending.push({ cypher: REMOVE, params: { id } });
  }

  /** Sync checkpoint (GraphStore contract). DB persistence is `flush`. */
  commit(): void {
    // no-op: the working copy is authoritative until flush() persists to the DB
  }

  /** The Cypher ops recorded since the last flush (inspection / batching). */
  pendingCypher(): readonly CypherOp[] {
    return this.pending;
  }

  /** Persist the recorded mutations to the DB as a batch, then clear them. */
  async flush(session: CypherSession): Promise<void> {
    for (const op of this.pending) await session.run(op.cypher, op.params);
    this.pending.length = 0;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/cypher-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: green; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/model/cypher-store.ts src/model/tests/cypher-store.test.ts
git commit -m "feat(model): CypherGraphStore — Cypher-backed GraphStore over a CypherSession seam

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `load` from a fake DB + shared conformance + exports

**Files:**
- Modify: `src/model/tests/cypher-store.test.ts` (append load + conformance)
- Modify: `src/index.ts` (exports)

**Interfaces:**
- Consumes: `describeGraphStore` (Phase 6 conformance); `CypherGraphStore.load`.
- Produces: `CypherGraphStore`, `CypherSession`, `CypherOp`, `CypherRow` on the package root.

- [ ] **Step 1: Append the load + conformance tests**

Append to `src/model/tests/cypher-store.test.ts`:

```ts
import { describeGraphStore } from "./graph-store-conformance.js";

// A fake session that returns canned node/edge rows for the load queries.
class DataSession implements CypherSession {
  constructor(
    private readonly nodes: CypherRow[],
    private readonly edges: CypherRow[],
  ) {}
  async run(cypher: string): Promise<CypherRow[]> {
    if (cypher.includes("properties(n)")) return this.nodes;
    if (cypher.includes("-[r:REL]->")) return this.edges;
    return [];
  }
}

test("load rebuilds the working copy from DB rows", async () => {
  const session = new DataSession(
    [
      { id: "copilot", tier: "Instance", typeOf: "technology", props: { id: "copilot", tier: "Instance", typeOf: "technology", label: "Copilot" } },
      { id: "gw", tier: "Instance", typeOf: "component", props: { id: "gw", tier: "Instance", typeOf: "component" } },
    ],
    [{ from: "gw", to: "copilot", kind: "Relationship", via: "implemented-by" }],
  );
  const store = await CypherGraphStore.load(session);
  assert.equal(store.getNode("copilot")?.attrs.get("label"), "Copilot");
  assert.equal(store.getNode("copilot")?.attrs.has("typeOf"), false); // structural props stripped
  assert.deepEqual(store.instancesOf("component"), ["gw"]);
  assert.deepEqual(store.outEdges("gw").map((e) => e.to), ["copilot"]);
  assert.equal(store.pendingCypher().length, 0); // loaded data is not a pending write
});

// Same contract as InMemoryGraphStore — the seam is proven against both back-ends.
describeGraphStore("CypherGraphStore", () => new CypherGraphStore());
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/cypher-store.test.ts`
Expected: PASS — load reconstructs the graph; the 7 conformance cases pass against `CypherGraphStore` (served synchronously by the working copy).

- [ ] **Step 3: Add exports**

In `src/index.ts`, after the `GraphStore` export, add:

```ts
export {
  CypherGraphStore,
  type CypherSession,
  type CypherOp,
  type CypherRow,
} from "./model/cypher-store.js";
```

- [ ] **Step 4: Full suite + typecheck + build**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`, then `npm run typecheck`, then `npm run build`
Expected: whole suite green; typecheck clean; build exits 0 and emits `dist/model/cypher-store.js`.

- [ ] **Step 5: Commit**

```bash
git add src/model/tests/cypher-store.test.ts src/index.ts
git commit -m "feat(model): CypherGraphStore.load + conformance + exports (Component F Cypher complete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done-when

- `CypherGraphStore` implements `GraphStore` (sync working copy), records the mapped Cypher per mutation, loads the graph from a `CypherSession`, and flushes recorded ops to the DB; `commit()` is the sync checkpoint, `flush(session)` persists.
- It passes the same `describeGraphStore` conformance suite as `InMemoryGraphStore`; translation + load are unit-tested against fake sessions; exports are in place; whole suite green, typecheck clean, build emits the module.
- No new dependency; no live DB needed to validate.
- **Explicitly out of scope (documented, gated on a real DB):** a concrete neo4j-driver `CypherSession` adapter and a live round-trip against a running database — a thin consumer adapter over the seam this phase defines. Wiring `CypherGraphStore` in behind `Repository`/`ModelDraft` for a real project is a follow-on integration, not part of this TypeScript phase.
