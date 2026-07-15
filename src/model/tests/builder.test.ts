import { test } from "node:test";
import assert from "node:assert/strict";

import { Graph, EdgeKind, Direction } from "../graph.js";
import { Builder } from "../builder.js";

test("assertInstance + commit creates a typed node", () => {
  const graph = new Graph();
  new Builder(graph).assertInstance("technology", "react").commit();

  assert.equal(graph.hasNode("react"), true);
  assert.equal(graph.getNode("react")?.typeOf, "technology");
});

test("setField + commit writes a scalar attr", () => {
  const graph = new Graph();
  new Builder(graph)
    .assertInstance("technology", "react")
    .setField("react", "label", "React")
    .commit();

  assert.equal(graph.getNode("react")?.attrs.get("label"), "React");
});

test("addRelationship resolves a forward reference on commit", () => {
  const graph = new Graph();
  const builder = new Builder(graph);
  // relationship declared BEFORE its target is asserted
  builder.addRelationship("shop-web", "implemented-by", "react");
  builder.assertInstance("frontend", "shop-web");
  builder.assertInstance("technology", "react");
  builder.commit();

  assert.deepEqual(
    graph.related("shop-web", EdgeKind.Relationship, Direction.Out, "implemented-by"),
    ["react"],
  );
});

test("commit is atomic: an unresolved relationship target aborts without mutating", () => {
  const graph = new Graph();
  const builder = new Builder(graph);
  builder.assertInstance("frontend", "shop-web");
  builder.addRelationship("shop-web", "implemented-by", "ghost"); // never asserted

  assert.throws(() => builder.commit(), /does not exist/i);
  assert.equal(graph.hasNode("shop-web"), false, "no partial mutation");
});

test("commit rejects asserting a node that already exists", () => {
  const graph = new Graph();
  new Builder(graph).assertInstance("technology", "react").commit();

  assert.throws(() => new Builder(graph).assertInstance("technology", "react").commit(), /already exists/i);
});

test("commit clears staging; a second commit is a no-op", () => {
  const graph = new Graph();
  const builder = new Builder(graph);
  builder.assertInstance("technology", "react").commit();
  builder.commit();

  assert.equal(graph.nodeCount, 1);
});

test("committed mutations flow through the change bus in order", () => {
  const graph = new Graph();
  const events: (string | null)[] = [];
  graph.changed.subscribe((change) => events.push(change.property ?? change.node));

  new Builder(graph)
    .assertInstance("technology", "react")
    .setField("react", "label", "React")
    .commit();

  assert.deepEqual(events, ["react", "label"]);
});
