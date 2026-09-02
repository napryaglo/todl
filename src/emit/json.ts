/**
 * Portable JSON emitter (design spec §7.2) — serialise the graph to a plain,
 * stringifiable document and rebuild it. Enums are written by member name (not
 * their numeric value) so the wire form is stable and human-legible; attrs are
 * a plain object. This is the interchange / storage / hand-off shape.
 */

import { Graph, Tier, EdgeKind, type Node, type Edge, type NodeId, type Scalar } from "../model/graph.js";
import { Repository } from "../model/model.js";

/** Human-readable metadata about an entity, added only in debug emit. Opaque
 *  ids stay in `id`/`typeOf`; this says what the entity *is* in plain terms. */
export interface NodeDebug {
  /** Meta-kind: "concept" / "field" / "model" / "annotation" / … for ontology
   *  declarations, or "instance" for an instance of a concept. */
  kind: string;
  /** The entity's readable name/label. */
  name: string;
  /** The readable name of its `typeOf` — the concept an instance instantiates,
   *  or the meta-kind for an ontology declaration. */
  type: string;
  /** The entity's namespace, when it has one. */
  namespace?: string;
  /** The source .todl the entity was declared in, when provenance is supplied. */
  source?: string;
}

/** Readable endpoint names behind an edge's opaque `from`/`to`/`via` ids. */
export interface EdgeDebug {
  from: string;
  to: string;
  via?: string;
}

/** Opt-in emit controls. `debug` off ⇒ byte-identical to the plain wire form. */
export interface EmitOptions {
  /** Attach `debug` blocks to every node and edge. */
  debug?: boolean;
  /** nodeId → source uri (as returned by `check`/`load`), for `debug.source`. */
  provenance?: ReadonlyMap<string, string>;
}

export interface JsonNode {
  id: NodeId;
  tier: string;
  typeOf: NodeId;
  attrs: Record<string, Scalar>;
  debug?: NodeDebug;
}

export interface JsonEdge {
  kind: string;
  via: NodeId | null;
  from: NodeId;
  to: NodeId;
  debug?: EdgeDebug;
}

export interface TodlDocument {
  nodes: JsonNode[];
  edges: JsonEdge[];
}

/** An entity's readable name: its declared `name`, else its instance `id`
 *  attr, else the node id (which for ontology declarations *is* the name). */
function nodeName(node: Node): string {
  return String(node.attrs.get("name") ?? node.attrs.get("id") ?? node.id);
}

function nodeDebug(model: Repository, node: Node, provenance?: ReadonlyMap<string, string>): NodeDebug {
  // A `typeOf` that resolves to a real node is a concept id ⇒ this is an
  // instance of it. Otherwise `typeOf` is a meta-kind sentinel ("concept",
  // "field", "model", …) that has no backing node.
  const typeNode = model.resolve(node.typeOf);
  const debug: NodeDebug = {
    kind: typeNode ? "instance" : node.typeOf,
    name: nodeName(node),
    type: typeNode ? nodeName(typeNode) : node.typeOf,
  };
  const namespace = node.attrs.get("namespace");
  if (namespace !== undefined) debug.namespace = String(namespace);
  const source = provenance?.get(node.id);
  if (source !== undefined) debug.source = source;
  return debug;
}

function edgeDebug(model: Repository, edge: Edge): EdgeDebug {
  const nameOf = (id: NodeId): string => {
    const node = model.resolve(id);
    return node ? nodeName(node) : id;
  };
  const debug: EdgeDebug = { from: nameOf(edge.from), to: nameOf(edge.to) };
  if (edge.via !== null) debug.via = nameOf(edge.via);
  return debug;
}

function emitNode(model: Repository, node: Node, options?: EmitOptions): JsonNode {
  const json: JsonNode = {
    id: node.id,
    tier: Tier[node.tier],
    typeOf: node.typeOf,
    attrs: Object.fromEntries(node.attrs),
  };
  if (options?.debug) json.debug = nodeDebug(model, node, options.provenance);
  return json;
}

function emitEdge(model: Repository, edge: Edge, options?: EmitOptions): JsonEdge {
  const json: JsonEdge = { kind: EdgeKind[edge.kind], via: edge.via, from: edge.from, to: edge.to };
  if (options?.debug) json.debug = edgeDebug(model, edge);
  return json;
}

export function toJSON(model: Repository, options?: EmitOptions): TodlDocument {
  const nodes: JsonNode[] = [];
  const edges: JsonEdge[] = [];

  for (const node of model.allNodes()) {
    nodes.push(emitNode(model, node, options));
    for (const edge of model.outEdges(node.id)) {
      edges.push(emitEdge(model, edge, options));
    }
  }

  return { nodes, edges };
}

/**
 * Own-scoped emit: serialise only the nodes in `ownIds` and their out-edges.
 * An out-edge whose `to` is not in `ownIds` (a reference to a base node) is
 * kept as a dangling id — resolved at load when the base package is also
 * loaded. Bases never reference own nodes, so no own-relevant edge is missed.
 */
export function toJSONOwn(
  model: Repository,
  ownIds: ReadonlySet<NodeId>,
  options?: EmitOptions,
): TodlDocument {
  const nodes: JsonNode[] = [];
  const edges: JsonEdge[] = [];

  for (const node of model.allNodes()) {
    if (!ownIds.has(node.id)) continue;
    nodes.push(emitNode(model, node, options));
    for (const edge of model.outEdges(node.id)) {
      edges.push(emitEdge(model, edge, options));
    }
  }

  return { nodes, edges };
}

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
