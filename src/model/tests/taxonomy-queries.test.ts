import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, EdgeKind, Tier } from "../graph.js";
import { MetaKind } from "../kinds.js";
import { Repository } from "../model.js";

// Build a 3-level taxonomy by hand: root -> mid -> leaf, plus a sibling leaf.
function taxo(): Repository {
  const g = new Graph();
  g.addNode({ id: "cc", tier: Tier.Ontology, typeOf: MetaKind.Taxonomy, attrs: new Map() });
  for (const id of ["cc.surface", "cc.api-service", "cc.web-portal", "cc.data-store"])
    g.addNode({ id, tier: Tier.Ontology, typeOf: "cc", attrs: new Map() });
  // surface -> {api-service, web-portal}; broader -> narrower
  g.addEdge({ kind: EdgeKind.Narrower, via: null, from: "cc.surface", to: "cc.api-service" });
  g.addEdge({ kind: EdgeKind.Narrower, via: null, from: "cc.surface", to: "cc.web-portal" });
  return new Repository(g);
}

test("narrowerOf returns direct children; broaderOf the direct parent", () => {
  const m = taxo();
  assert.deepEqual(m.narrowerOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
  assert.deepEqual(m.broaderOf("cc.api-service"), ["cc.surface"]);
  assert.deepEqual(m.narrowerOf("cc.api-service"), []);
});

test("descendantsOf/ancestorsOf walk the whole branch; flat terms return empty", () => {
  const m = taxo();
  assert.deepEqual(m.descendantsOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
  assert.deepEqual(m.ancestorsOf("cc.api-service"), ["cc.surface"]);
  assert.deepEqual(m.descendantsOf("cc.data-store"), []); // flat/root term
});
