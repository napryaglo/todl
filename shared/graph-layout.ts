import type { TodlDocument, JsonNode } from "@pragmatic-tech-ai/todl";

export interface LaidOutNode { id: string; x: number; y: number; w: number; h: number; label: string; sub: string }
export interface LaidOutEdge { from: string; to: string; label: string }
export interface GraphLayout { nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number }

const NODE_W = 150, NODE_H = 48, H_GAP = 70, V_GAP = 26, PAD = 24;

/** A readable label for a node: a name-ish attribute, else its tier + id, else
 *  the raw id. Kept deterministic for stable rendering + tests. */
export function nodeLabel(node: JsonNode): string {
  const a = node.attrs ?? {};
  for (const key of ["name", "label", "id", "title"]) {
    const v = a[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (node.tier) return `${node.tier}#${node.id}`;
  return String(node.id);
}

/** Longest-path rank from any root (no incoming edge). Cycles are broken by the
 *  visited guard (a back-edge simply doesn't raise the rank further). */
function ranks(ids: string[], adj: Map<string, string[]>, indeg: Map<string, number>): Map<string, number> {
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0).sort();
  const seen = new Set<string>();
  while (queue.length) {
    const u = queue.shift()!;
    if (seen.has(u)) continue;
    seen.add(u);
    for (const v of adj.get(u) ?? []) {
      if (rank.get(v)! < rank.get(u)! + 1) rank.set(v, rank.get(u)! + 1);
      queue.push(v);
    }
    queue.sort((a, b) => rank.get(a)! - rank.get(b)! || a.localeCompare(b));
  }
  return rank;
}

export function layoutGraph(doc: TodlDocument): GraphLayout {
  const ids = doc.nodes.map((n) => String(n.id));
  const idSet = new Set(ids);
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const edges: LaidOutEdge[] = [];
  for (const e of doc.edges) {
    const from = String(e.from), to = String(e.to);
    if (!idSet.has(from) || !idSet.has(to)) continue; // skip dangling base refs
    adj.get(from)!.push(to);
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
    edges.push({ from, to, label: e.kind });
  }

  const rank = ranks(ids, adj, indeg);
  // Group by rank, order within a rank by id for stability.
  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const r = rank.get(id)!;
    const col = byRank.get(r) ?? (byRank.set(r, []), byRank.get(r)!);
    col.push(id);
  }
  const labelOf = new Map(doc.nodes.map((n) => [String(n.id), { label: nodeLabel(n), sub: n.tier ?? "" }]));

  const nodes: LaidOutNode[] = [];
  let maxRow = 0;
  for (const [r, col] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    col.sort((a, b) => a.localeCompare(b));
    col.forEach((id, row) => {
      const meta = labelOf.get(id)!;
      nodes.push({
        id, label: meta.label, sub: meta.sub, w: NODE_W, h: NODE_H,
        x: PAD + r * (NODE_W + H_GAP),
        y: PAD + row * (NODE_H + V_GAP),
      });
      if (row > maxRow) maxRow = row;
    });
  }

  const cols = byRank.size;
  const width = nodes.length ? PAD * 2 + cols * NODE_W + Math.max(0, cols - 1) * H_GAP : 0;
  const height = nodes.length ? PAD * 2 + (maxRow + 1) * NODE_H + maxRow * V_GAP : 0;
  return { nodes, edges, width, height };
}
