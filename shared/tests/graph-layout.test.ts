import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGraph, nodeLabel, edgeGeometry } from "../graph-layout.js";
import type { TodlDocument } from "@pragmatic-tech-ai/todl";

const doc: TodlDocument = {
  nodes: [
    { id: 1, tier: "instance", typeOf: 10, attrs: { name: "a" } },
    { id: 2, tier: "instance", typeOf: 10, attrs: { name: "b" } },
    { id: 3, tier: "instance", typeOf: 10, attrs: {} },
  ],
  edges: [{ kind: "calls", via: null, from: 1, to: 2 }],
};

test("every node gets a position and a label", () => {
  const g = layoutGraph(doc);
  assert.equal(g.nodes.length, 3);
  for (const n of g.nodes) {
    assert.equal(typeof n.x, "number");
    assert.equal(typeof n.y, "number");
    assert.ok(n.w > 0 && n.h > 0);
    assert.ok(n.label.length > 0);
  }
  assert.equal(g.edges.length, 1);
});

test("an edge target ranks to the right of its source", () => {
  const g = layoutGraph(doc);
  const a = g.nodes.find((n) => n.id === "1")!;
  const b = g.nodes.find((n) => n.id === "2")!;
  assert.ok(b.x > a.x, "target should be in a later column than source");
});

test("layout is deterministic across runs", () => {
  assert.deepEqual(layoutGraph(doc), layoutGraph(doc));
});

test("overall size bounds all node boxes", () => {
  const g = layoutGraph(doc);
  for (const n of g.nodes) {
    assert.ok(n.x + n.w <= g.width);
    assert.ok(n.y + n.h <= g.height);
  }
});

test("empty document yields an empty, zero-ish layout", () => {
  const g = layoutGraph({ nodes: [], edges: [] });
  assert.equal(g.nodes.length, 0);
  assert.equal(g.edges.length, 0);
});

test("nodeLabel prefers a name/label attr, else falls back", () => {
  assert.equal(nodeLabel({ id: 5, tier: "instance", typeOf: 9, attrs: { name: "svc" } }), "svc");
  const fallback = nodeLabel({ id: 7, tier: "concept", typeOf: 0, attrs: {} });
  assert.ok(fallback.length > 0);
});

test("laid-out nodes carry attrs and typeOf from the source", () => {
  const d: TodlDocument = { nodes: [{ id: 1, tier: "instance", typeOf: 10, attrs: { name: "a", n: 2 } }], edges: [] };
  const g = layoutGraph(d);
  assert.equal(g.nodes[0].typeOf, "10");
  assert.equal(g.nodes[0].attrs.name, "a");
  assert.equal(g.nodes[0].attrs.n, 2);
});

test("edgeGeometry gives center-to-center endpoints, midpoint, and angle", () => {
  const from = { id: "1", x: 0, y: 0, w: 100, h: 40, label: "", sub: "", typeOf: "", attrs: {} };
  const to = { id: "2", x: 200, y: 0, w: 100, h: 40, label: "", sub: "", typeOf: "", attrs: {} };
  const e = edgeGeometry(from, to);
  assert.equal(e.x1, 50); assert.equal(e.y1, 20);
  assert.equal(e.x2, 250); assert.equal(e.y2, 20);
  assert.equal(e.midX, 150); assert.equal(e.midY, 20);
  assert.equal(Math.round(e.angleDeg), 0);
});

test("edgeGeometry angle is 90 for a downward edge", () => {
  const from = { id: "1", x: 0, y: 0, w: 40, h: 40, label: "", sub: "", typeOf: "", attrs: {} };
  const to = { id: "2", x: 0, y: 200, w: 40, h: 40, label: "", sub: "", typeOf: "", attrs: {} };
  assert.equal(Math.round(edgeGeometry(from, to).angleDeg), 90);
});
