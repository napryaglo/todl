import { test } from "node:test";
import assert from "node:assert/strict";
import { byId, groups, byGroup } from "../corpus-access.js";
import type { CorpusEntry } from "../corpus-types.js";

const mk = (id: string, group: string, order: number): CorpusEntry => ({
  manifest: { id, title: id, group, order, tags: [], narrative: "", files: [], expectClean: true },
  sources: [], golden: { diagnostics: [], document: { nodes: [], edges: [] } }, dir: `examples/x/${id}`,
});
const corpus = [mk("b", "G2", 1), mk("a", "G1", 2), mk("c", "G1", 1)];

test("byId finds by id", () => assert.equal(byId(corpus, "a")?.manifest.id, "a"));
test("byId misses cleanly", () => assert.equal(byId(corpus, "nope"), undefined));
test("groups are unique and sorted", () => assert.deepEqual(groups(corpus), ["G1", "G2"]));
test("byGroup buckets and orders within a group by manifest.order", () => {
  const g = byGroup(corpus);
  assert.deepEqual(g.get("G1")!.map((e) => e.manifest.id), ["c", "a"]);
});
