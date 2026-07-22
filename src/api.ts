import { load, loadInto } from "./parse/loader.js";
import { validate } from "./validate/validate.js";
import { Graph, Tier, EdgeKind } from "./model/graph.js";
import { Repository } from "./model/model.js";
import type { TodlDocument } from "./emit/json.js";
import type { SourceFile } from "./diagnostics/span.js";
import type { Diagnostic } from "./diagnostics/diagnostic.js";

/** Load the sources and validate the result; every diagnostic is spanned. */
export function check(sources: SourceFile[]): { model: Repository; diagnostics: Diagnostic[] } {
  const { model, diagnostics } = load(sources);
  return { model, diagnostics: [...diagnostics, ...validate(model)] };
}

/**
 * Load + validate `sources` against already-compiled base models (published
 * meta-models / libraries, as TodlDocument JSON). Bases seed the graph so a
 * source reference resolves to a base node instead of stubbing UNRESOLVED.
 * `checkAgainst([], sources)` is equivalent to `check(sources)`.
 */
export function checkAgainst(
  bases: TodlDocument[],
  sources: SourceFile[],
): { model: Repository; diagnostics: Diagnostic[] } {
  const model = new Repository(mergeBases(bases));
  const diagnostics = loadInto(model, sources);
  return { model, diagnostics: [...diagnostics, ...validate(model)] };
}

/**
 * Deserialize base documents into one graph with idempotent first-wins dedup:
 * a node id already present is kept (first base wins); an edge identical to one
 * already present (kind + via + from + to) is dropped — so bases sharing a
 * foundation (a library carrying its meta-model) compose without duplicate nodes
 * or double-counted edges. All nodes are added before any edges, since an edge
 * requires both endpoints to exist.
 */
function mergeBases(bases: TodlDocument[]): Graph {
  const graph = new Graph();
  for (const base of bases) {
    for (const node of base.nodes) {
      if (graph.hasNode(node.id)) continue;
      graph.addNode({
        id: node.id,
        tier: Tier[node.tier as keyof typeof Tier],
        typeOf: node.typeOf,
        attrs: new Map(Object.entries(node.attrs)),
      });
    }
  }
  for (const base of bases) {
    for (const edge of base.edges) {
      const kind = EdgeKind[edge.kind as keyof typeof EdgeKind];
      if (hasEdge(graph, kind, edge.via, edge.from, edge.to)) continue;
      graph.addEdge({ kind, via: edge.via, from: edge.from, to: edge.to });
    }
  }
  return graph;
}

/** Is an identical edge (kind + via + from + to) already on the graph? */
function hasEdge(graph: Graph, kind: EdgeKind, via: string | null, from: string, to: string): boolean {
  for (const e of graph.outEdges(from)) {
    if (e.kind === kind && e.via === via && e.to === to) return true;
  }
  return false;
}
