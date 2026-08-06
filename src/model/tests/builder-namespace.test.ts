import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, Tier } from "../graph.js";
import { MetaKind } from "../kinds.js";
import { Builder } from "../builder.js";

test("assertModel stages an Instance-tier node typed by MetaKind.Model", () => {
  const graph = new Graph();
  new Builder(graph).assertModel("prod").commit();
  const node = graph.getNode("prod");
  assert.ok(node);
  assert.equal(node!.tier, Tier.Instance);
  assert.equal(node!.typeOf, MetaKind.Model);
});

test("setNamespace stamps a namespace attr on every staged node", () => {
  const graph = new Graph();
  new Builder(graph).setNamespace("acme").defineConcept("thing").assertInstance("thing", "t1").commit();
  assert.equal(graph.getNode("thing")!.attrs.get("namespace"), "acme");
  assert.equal(graph.getNode("t1")!.attrs.get("namespace"), "acme");
});

test("a field member node is stamped with the namespace too", () => {
  const graph = new Graph();
  const b = new Builder(graph).setNamespace("acme").defineConcept("thing");
  b.addField("thing", "label", "string");
  b.commit();
  assert.equal(graph.getNode("Thing.Label")!.attrs.get("namespace"), "acme");
});
