/**
 * Portable JSON emitter (design spec §7.2) — serialise the graph to a plain,
 * stringifiable document and rebuild it. Enums are written by member name (not
 * their numeric value) so the wire form is stable and human-legible; attrs are
 * a plain object. This is the interchange / storage / hand-off shape.
 */

import { Graph, Tier, EdgeKind, type NodeId, type Scalar } from "../model/graph.js";
import { Model } from "../model/model.js";

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

export function toJSON(model: Model): TodlDocument {
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

export function fromJSON(doc: TodlDocument): Model {
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

  return new Model(graph);
}
