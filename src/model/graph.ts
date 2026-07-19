/**
 * The reflective typed graph — the runtime hub (design spec §1, §R1).
 *
 * Everything is a {@link Node}; every relationship is a typed {@link Edge}.
 * The store keeps dual adjacency (forward `out` + reverse `in`, so reverse
 * traversal is free) plus a type index (`byType`, backing `instancesOf`).
 * Filtered accessors and closure caching layer on top in a later step.
 */

import { Signal } from "../core/signal.js";

export type NodeId = string;

/** Which layer of the reflective tower a node lives in (spec §1). */
export enum Tier {
  Meta,
  Ontology,
  Instance,
}

/**
 * The structural kind of an edge. Domain-relationship and derived-member
 * *names* are data-driven (per-ontology) and cannot be enumerated, so they
 * are carried on {@link Edge.via} rather than baked into this enum.
 */
export enum EdgeKind {
  TypeOf,
  Extends,
  Contains,
  HasField,
  HasRelationship,
  HasInvariant,
  Relationship,
  Derived,
  Narrower, // taxonomy hierarchy: broader term -> narrower term
}

/** Which way to walk an edge from a node. */
export enum Direction {
  Out,
  In,
}

/** Field / relationship multiplicity — the surface `T` / `T?` / `T[]` / `T[+]`. */
export enum Cardinality {
  One, // T        required single
  Optional, // T?  optional single
  Many, // T[]     list, zero or more
  NonEmpty, // T[+] non-empty list
}

/** A literal field value. Enum selections and references are edges, not attrs. */
export type Scalar = string | number | boolean;

export interface Node {
  id: NodeId;
  tier: Tier;
  /** The concept (for an instance) or meta-kind (for a concept) — the type-of spine. */
  typeOf: NodeId;
  /** Scalar field values only. */
  attrs: Map<string, Scalar>;
}

export interface Edge {
  kind: EdgeKind;
  /** For {@link EdgeKind.Relationship} / {@link EdgeKind.Derived}: the member node it realises; else `null`. */
  via: NodeId | null;
  from: NodeId;
  to: NodeId;
}

/** The kind of mutation reported on {@link Graph.changed}. */
export enum GraphChangeKind {
  NodeAdded,
  NodeRemoved,
  EdgeAdded,
  EdgeRemoved,
  AttrSet,
}

/**
 * A single mutation event on the graph change bus (spec §R2). One applied
 * change → one event → façade re-raise, derived-cache invalidation, and
 * incremental validation all subscribe to the same stream.
 */
export interface GraphChangeArgs {
  kind: GraphChangeKind;
  /** The node the change is about; for an edge, its source. */
  node: NodeId;
  /** Field / relationship name, or `null` for whole-node and structural changes. */
  property: string | null;
  /** For an edge change, the other endpoint (the item); `null` otherwise. */
  target: NodeId | null;
}

export class Graph {
  private readonly _nodes = new Map<NodeId, Node>();
  private readonly _out = new Map<NodeId, Edge[]>();
  private readonly _in = new Map<NodeId, Edge[]>();
  private readonly _byType = new Map<NodeId, Set<NodeId>>();

  /** The mutation event bus (spec §R2): one event per applied change. */
  readonly changed = new Signal<GraphChangeArgs>();

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

    this.changed.emit({ kind: GraphChangeKind.NodeAdded, node: node.id, property: null, target: null });
  }

  getNode(id: NodeId): Node | undefined {
    return this._nodes.get(id);
  }

  hasNode(id: NodeId): boolean {
    return this._nodes.has(id);
  }

  get nodeCount(): number {
    return this._nodes.size;
  }

  /** Every node in the graph. */
  allNodes(): Node[] {
    return [...this._nodes.values()];
  }

  /** Node ids whose `typeOf` is `concept`. */
  instancesOf(concept: NodeId): NodeId[] {
    const bucket = this._byType.get(concept);
    return bucket === undefined ? [] : [...bucket];
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

    const property =
      edge.kind === EdgeKind.Relationship || edge.kind === EdgeKind.Derived ? edge.via : null;
    this.changed.emit({ kind: GraphChangeKind.EdgeAdded, node: edge.from, property, target: edge.to });
  }

  /** Set a scalar field value on a node and emit {@link GraphChangeKind.AttrSet}. */
  setAttr(id: NodeId, name: string, value: Scalar): void {
    const node = this._nodes.get(id);
    if (node === undefined) {
      throw new Error(`node "${id}" does not exist`);
    }
    node.attrs.set(name, value);
    this.changed.emit({ kind: GraphChangeKind.AttrSet, node: id, property: name, target: null });
  }

  /** All edges leaving `id` (forward adjacency). */
  outEdges(id: NodeId): Edge[] {
    return this._out.get(id) ?? [];
  }

  /** All edges entering `id` (reverse adjacency). */
  inEdges(id: NodeId): Edge[] {
    return this._in.get(id) ?? [];
  }

  /**
   * Neighbours reached from `id` by edges of `kind` in `direction`. When `via`
   * is given, only domain-relationship / derived edges realising that member
   * match.
   */
  related(id: NodeId, kind: EdgeKind, direction: Direction, via: NodeId | null = null): NodeId[] {
    const edges = direction === Direction.Out ? this.outEdges(id) : this.inEdges(id);
    const result: NodeId[] = [];
    for (const edge of edges) {
      if (edge.kind !== kind) continue;
      if (via !== null && edge.via !== via) continue;
      result.push(direction === Direction.Out ? edge.to : edge.from);
    }
    return result;
  }

  /**
   * Transitive closure of {@link related} from `start`. `reflexive` includes
   * `start` itself (the `*` form; `false` gives the proper `+` form). Cycle-safe.
   */
  closure(
    start: NodeId,
    kind: EdgeKind,
    direction: Direction,
    reflexive: boolean,
    via: NodeId | null = null,
  ): NodeId[] {
    const seen = new Set<NodeId>();
    const result: NodeId[] = [];
    const queue: NodeId[] = this.related(start, kind, direction, via);
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      result.push(current);
      for (const next of this.related(current, kind, direction, via)) {
        if (!seen.has(next)) queue.push(next);
      }
    }
    if (reflexive && !seen.has(start)) {
      result.unshift(start);
    }
    return result;
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
