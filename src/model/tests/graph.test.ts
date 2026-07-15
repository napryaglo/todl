import { test } from "node:test";
import assert from "node:assert/strict";

import { Graph, Tier, EdgeKind, type Node, type Edge } from "../graph.js";

function instance(id: string, typeOf: string): Node {
  return { id, tier: Tier.Instance, typeOf, attrs: new Map() };
}

test("addNode registers a node retrievable by id", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));

  assert.equal(graph.hasNode("react"), true);
  assert.equal(graph.getNode("react")?.typeOf, "technology");
  assert.equal(graph.nodeCount, 1);
});

test("getNode returns undefined for an unknown id", () => {
  const graph = new Graph();
  assert.equal(graph.getNode("ghost"), undefined);
  assert.equal(graph.hasNode("ghost"), false);
});

test("addNode rejects a duplicate id", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));
  assert.throws(() => graph.addNode(instance("react", "technology")), /already exists/i);
});

test("instancesOf lists node ids grouped by their concept", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));
  graph.addNode(instance("vue", "technology"));
  graph.addNode(instance("shop-web", "frontend"));

  assert.deepEqual(new Set(graph.instancesOf("technology")), new Set(["react", "vue"]));
  assert.deepEqual(graph.instancesOf("frontend"), ["shop-web"]);
  assert.deepEqual(graph.instancesOf("nonexistent"), []);
});

test("addEdge records forward and reverse adjacency", () => {
  const graph = new Graph();
  graph.addNode(instance("shop-web", "frontend"));
  graph.addNode(instance("react", "technology"));

  const edge: Edge = {
    kind: EdgeKind.Relationship,
    via: "implemented-by",
    from: "shop-web",
    to: "react",
  };
  graph.addEdge(edge);

  assert.deepEqual(graph.outEdges("shop-web"), [edge]);
  assert.deepEqual(graph.inEdges("react"), [edge]);
  assert.deepEqual(graph.outEdges("react"), []);
  assert.deepEqual(graph.inEdges("shop-web"), []);
});

test("addEdge requires both endpoints to exist", () => {
  const graph = new Graph();
  graph.addNode(instance("shop-web", "frontend"));

  assert.throws(
    () =>
      graph.addEdge({
        kind: EdgeKind.Relationship,
        via: "implemented-by",
        from: "shop-web",
        to: "ghost",
      }),
    /does not exist/i,
  );
  assert.throws(
    () =>
      graph.addEdge({
        kind: EdgeKind.Relationship,
        via: "implemented-by",
        from: "ghost",
        to: "shop-web",
      }),
    /does not exist/i,
  );
});
