import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, EdgeKind, Tier } from "../graph.js";
import { MetaKind } from "../kinds.js";
import { Repository } from "../model.js";

// Build a 3-level taxonomy by hand: root -> mid -> leaf, plus a sibling leaf.
function taxo(): Repository {
  const g = new Graph();
  g.addNode({ id: "cc", tier: Tier.Ontology, typeOf: MetaKind.Taxonomy, attrs: new Map() });
  for (const id of ["cc.Surface", "cc.ApiService", "cc.WebPortal", "cc.DataStore"])
    g.addNode({ id, tier: Tier.Ontology, typeOf: "cc", attrs: new Map() });
  // surface -> {api-service, web-portal}; broader -> narrower
  g.addEdge({ kind: EdgeKind.Narrower, via: null, from: "cc.Surface", to: "cc.ApiService" });
  g.addEdge({ kind: EdgeKind.Narrower, via: null, from: "cc.Surface", to: "cc.WebPortal" });
  return new Repository(g);
}

test("narrowerOf returns direct children; broaderOf the direct parent", () => {
  const m = taxo();
  assert.deepEqual(m.narrowerOf("cc.Surface").sort(), ["cc.ApiService", "cc.WebPortal"]);
  assert.deepEqual(m.broaderOf("cc.ApiService"), ["cc.Surface"]);
  assert.deepEqual(m.narrowerOf("cc.ApiService"), []);
});

test("descendantsOf/ancestorsOf walk the whole branch; flat terms return empty", () => {
  const m = taxo();
  assert.deepEqual(m.descendantsOf("cc.Surface").sort(), ["cc.ApiService", "cc.WebPortal"]);
  assert.deepEqual(m.ancestorsOf("cc.ApiService"), ["cc.Surface"]);
  assert.deepEqual(m.descendantsOf("cc.DataStore"), []); // flat/root term
});
