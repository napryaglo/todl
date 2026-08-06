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
