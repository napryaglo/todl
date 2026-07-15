import { test } from "node:test";
import assert from "node:assert/strict";

import { Graph, Tier, EdgeKind, Direction, type Node } from "../graph.js";

function ontologyNode(id: string): Node {
  return { id, tier: Tier.Ontology, typeOf: "concept", attrs: new Map() };
}

function instanceNode(id: string, typeOf: string): Node {
  return { id, tier: Tier.Instance, typeOf, attrs: new Map() };
}

/** component <- frontend <- spa, via Extends edges (subtype -> supertype). */
function lattice(): Graph {
  const graph = new Graph();
  graph.addNode(ontologyNode("component"));
  graph.addNode(ontologyNode("frontend"));
  graph.addNode(ontologyNode("spa"));
  graph.addEdge({ kind: EdgeKind.Extends, via: null, from: "frontend", to: "component" });
  graph.addEdge({ kind: EdgeKind.Extends, via: null, from: "spa", to: "frontend" });
  return graph;
}

test("related follows edges of a kind in the forward direction", () => {
  const graph = lattice();
  assert.deepEqual(graph.related("spa", EdgeKind.Extends, Direction.Out), ["frontend"]);
});

test("related follows edges of a kind in the reverse direction", () => {
  const graph = lattice();
  assert.deepEqual(graph.related("component", EdgeKind.Extends, Direction.In), ["frontend"]);
});

test("closure walks the transitive supertypes (proper, excludes self)", () => {
  const graph = lattice();
  assert.deepEqual(
    new Set(graph.closure("spa", EdgeKind.Extends, Direction.Out, false)),
    new Set(["frontend", "component"]),
  );
});

test("reflexive closure includes the start node", () => {
  const graph = lattice();
  assert.deepEqual(
    new Set(graph.closure("spa", EdgeKind.Extends, Direction.Out, true)),
    new Set(["spa", "frontend", "component"]),
  );
});

test("reverse closure walks the transitive subtypes", () => {
  const graph = lattice();
  assert.deepEqual(
    new Set(graph.closure("component", EdgeKind.Extends, Direction.In, false)),
    new Set(["frontend", "spa"]),
  );
});

test("related and closure filter domain relationships by via", () => {
  const graph = new Graph();
  graph.addNode(instanceNode("ui-framework", "category"));
  graph.addNode(instanceNode("framework", "category"));
  graph.addNode(instanceNode("tech-category", "category"));
  // broader chain: ui-framework -> framework -> tech-category
  graph.addEdge({ kind: EdgeKind.Relationship, via: "broader", from: "ui-framework", to: "framework" });
  graph.addEdge({ kind: EdgeKind.Relationship, via: "broader", from: "framework", to: "tech-category" });
  // a same-kind edge with a different via must not leak into a broader walk
  graph.addEdge({ kind: EdgeKind.Relationship, via: "peer", from: "ui-framework", to: "tech-category" });

  assert.deepEqual(graph.related("ui-framework", EdgeKind.Relationship, Direction.Out, "broader"), ["framework"]);
  assert.deepEqual(
    new Set(graph.closure("ui-framework", EdgeKind.Relationship, Direction.Out, false, "broader")),
    new Set(["framework", "tech-category"]),
  );
});

test("closure is cycle-safe", () => {
  const graph = new Graph();
  graph.addNode(instanceNode("a", "category"));
  graph.addNode(instanceNode("b", "category"));
  graph.addEdge({ kind: EdgeKind.Relationship, via: "peer", from: "a", to: "b" });
  graph.addEdge({ kind: EdgeKind.Relationship, via: "peer", from: "b", to: "a" });

  assert.deepEqual(
    new Set(graph.closure("a", EdgeKind.Relationship, Direction.Out, false, "peer")),
    new Set(["a", "b"]),
  );
});
