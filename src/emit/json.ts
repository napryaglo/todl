/**
 * Portable JSON emitter (design spec §7.2) — serialise the graph to a plain,
 * stringifiable document and rebuild it. Enums are written by member name (not
 * their numeric value) so the wire form is stable and human-legible; attrs are
 * a plain object. This is the interchange / storage / hand-off shape.
 */

import { Graph, Tier, EdgeKind, type NodeId, type Scalar } from "../model/graph.js";
import { Repository } from "../model/model.js";

export interface JsonNode {
  id: NodeId;
  tier: string;
  typeOf: NodeId;
  attrs: Record<string, Scalar>;
}

export interface JsonEdge {
  kind: string;
  via: NodeId | null;
  from: NodeId;
  to: NodeId;
}

export interface TodlDocument {
  nodes: JsonNode[];
  edges: JsonEdge[];
}

export function toJSON(model: Repository): TodlDocument {
  const nodes: JsonNode[] = [];
  const edges: JsonEdge[] = [];

  for (const node of model.allNodes()) {
    nodes.push({
      id: node.id,
      tier: Tier[node.tier],
      typeOf: node.typeOf,
      attrs: Object.fromEntries(node.attrs),
    });
    for (const edge of model.outEdges(node.id)) {
      edges.push({ kind: EdgeKind[edge.kind], via: edge.via, from: edge.from, to: edge.to });
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
export function toJSONOwn(model: Repository, ownIds: ReadonlySet<NodeId>): TodlDocument {
  const nodes: JsonNode[] = [];
  const edges: JsonEdge[] = [];

  for (const node of model.allNodes()) {
    if (!ownIds.has(node.id)) continue;
    nodes.push({
      id: node.id,
      tier: Tier[node.tier],
      typeOf: node.typeOf,
      attrs: Object.fromEntries(node.attrs),
    });
    for (const edge of model.outEdges(node.id)) {
      edges.push({ kind: EdgeKind[edge.kind], via: edge.via, from: edge.from, to: edge.to });
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
