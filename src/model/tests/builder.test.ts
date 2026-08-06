import { test } from "node:test";
import assert from "node:assert/strict";

import { Graph, EdgeKind, Direction, Tier } from "../graph.js";
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
  builder.addRelationship("shop-web", "implementedBy", "react");
  builder.assertInstance("frontend", "shop-web");
  builder.assertInstance("technology", "react");
  builder.commit();

  assert.deepEqual(
    graph.related("shop-web", EdgeKind.Relationship, Direction.Out, "implementedBy"),
    ["react"],
  );
});

test("commit is atomic: an unresolved relationship target aborts without mutating", () => {
  const graph = new Graph();
  const builder = new Builder(graph);
  builder.assertInstance("frontend", "shop-web");
  builder.addRelationship("shop-web", "implementedBy", "ghost"); // never asserted

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

test("assertInstance asClass marks the node with class = true", () => {
  const graph = new Graph();
  new Builder(graph).assertInstance("component", "teamsChat", true).commit();
  assert.equal(graph.getNode("teamsChat")?.attrs.get("class"), true);
});

test("addInstanceOf links a leaf to its class", () => {
  const graph = new Graph();
  const b = new Builder(graph);
  b.assertInstance("component", "teamsChat", true);
  b.assertInstance("component", "chat-hq");
  b.addInstanceOf("chat-hq", "teamsChat");
  b.commit();
  assert.deepEqual(graph.related("chat-hq", EdgeKind.InstanceOf, Direction.Out), ["teamsChat"]);
});

test("defineTaxonomy stages the represented concept plus class terms", () => {
  const graph = new Graph();
  const b = new Builder(graph);
  b.defineConcept("category");
  b.defineTaxonomy("ComponentCategory", ["category"], [
    { id: "ConversationalInterface", attrs: new Map([["icon", "Chat.svg"]]) },
    { id: "surface", children: [{ id: "WebPortal" }] },
  ]);
  b.commit();

  const term = graph.getNode("ComponentCategory.ConversationalInterface");
  assert.equal(term?.tier, Tier.Instance);
  assert.equal(term?.typeOf, "category");
  assert.equal(term?.attrs.get("class"), true);
  assert.equal(term?.attrs.get("icon"), "Chat.svg");

  assert.deepEqual(graph.related("ComponentCategory", EdgeKind.Represents, Direction.Out), ["category"]);
  assert.deepEqual(
    graph.related("ComponentCategory", EdgeKind.Contains, Direction.Out).sort(),
    [
      "ComponentCategory.ConversationalInterface",
      "ComponentCategory.Surface",
      "ComponentCategory.WebPortal",
    ],
  );
  assert.deepEqual(
    graph.related("ComponentCategory.Surface", EdgeKind.Narrower, Direction.Out),
    ["ComponentCategory.WebPortal"],
  );
});

test("commit(skip) drops an edge to a skipped target instead of throwing", () => {
  const graph = new Graph();
  const b = new Builder(graph);
  b.assertInstance("thing", "a");
  b.addInstanceOf("a", "ghost"); // edge a -[InstanceOf]-> ghost (dangling)
  assert.doesNotThrow(() => b.commit(new Set(["ghost"])));
  assert.ok(graph.getNode("a") !== undefined, "the source node still commits");
  assert.equal(graph.getNode("ghost"), undefined, "the skipped target is not created");
});

test("commit still throws for a missing target that is NOT skipped", () => {
  const graph = new Graph();
  const b = new Builder(graph);
  b.assertInstance("thing", "a");
  b.addInstanceOf("a", "ghost");
  assert.throws(() => b.commit(new Set(["other"])), /edge target "ghost" does not exist/);
});
