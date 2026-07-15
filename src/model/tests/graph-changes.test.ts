import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Graph,
  Tier,
  EdgeKind,
  GraphChangeKind,
  type Node,
  type GraphChangeArgs,
} from "../graph.js";

function instance(id: string, typeOf: string): Node {
  return { id, tier: Tier.Instance, typeOf, attrs: new Map() };
}

function record(graph: Graph): GraphChangeArgs[] {
  const changes: GraphChangeArgs[] = [];
  graph.changed.subscribe((change) => changes.push(change));
  return changes;
}

test("addNode emits a NodeAdded change", () => {
  const graph = new Graph();
  const changes = record(graph);

  graph.addNode(instance("react", "technology"));

  assert.deepEqual(changes, [
    { kind: GraphChangeKind.NodeAdded, node: "react", property: null },
  ]);
});

test("addEdge for a domain relationship emits EdgeAdded carrying the relationship name", () => {
  const graph = new Graph();
  graph.addNode(instance("shop-web", "frontend"));
  graph.addNode(instance("react", "technology"));
  const changes = record(graph);

  graph.addEdge({ kind: EdgeKind.Relationship, via: "implemented-by", from: "shop-web", to: "react" });

  assert.deepEqual(changes, [
    { kind: GraphChangeKind.EdgeAdded, node: "shop-web", property: "implemented-by" },
  ]);
});

test("addEdge for a structural edge emits EdgeAdded with a null property", () => {
  const graph = new Graph();
  graph.addNode({ id: "frontend", tier: Tier.Ontology, typeOf: "concept", attrs: new Map() });
  graph.addNode({ id: "component", tier: Tier.Ontology, typeOf: "concept", attrs: new Map() });
  const changes = record(graph);

  graph.addEdge({ kind: EdgeKind.Extends, via: null, from: "frontend", to: "component" });

  assert.deepEqual(changes, [
    { kind: GraphChangeKind.EdgeAdded, node: "frontend", property: null },
  ]);
});

test("setAttr writes the value and emits AttrSet", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));
  const changes = record(graph);

  graph.setAttr("react", "label", "React");

  assert.equal(graph.getNode("react")?.attrs.get("label"), "React");
  assert.deepEqual(changes, [
    { kind: GraphChangeKind.AttrSet, node: "react", property: "label" },
  ]);
});

test("setAttr on an unknown node throws", () => {
  const graph = new Graph();
  assert.throws(() => graph.setAttr("ghost", "label", "x"), /does not exist/i);
});
