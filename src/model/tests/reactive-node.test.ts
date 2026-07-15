import { test } from "node:test";
import assert from "node:assert/strict";

import { Graph, Tier, EdgeKind, type Node } from "../graph.js";
import { ReactiveNode, PropertyChangeKind, type PropertyChangedArgs } from "../reactive.js";

function instance(id: string, typeOf: string): Node {
  return { id, tier: Tier.Instance, typeOf, attrs: new Map() };
}

function watch(view: ReactiveNode): PropertyChangedArgs[] {
  const seen: PropertyChangedArgs[] = [];
  view.propertyChanged.subscribe((args) => seen.push(args));
  return seen;
}

test("raises propertyChanged when a scalar attr is set", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));
  const view = new ReactiveNode(graph, "react");
  const seen = watch(view);

  graph.setAttr("react", "label", "React");

  assert.deepEqual(seen, [{ property: "label", kind: PropertyChangeKind.Set }]);
});

test("raises propertyChanged when a relationship edge is added", () => {
  const graph = new Graph();
  graph.addNode(instance("shop-web", "frontend"));
  graph.addNode(instance("react", "technology"));
  const view = new ReactiveNode(graph, "shop-web");
  const seen = watch(view);

  graph.addEdge({ kind: EdgeKind.Relationship, via: "implemented-by", from: "shop-web", to: "react" });

  assert.deepEqual(seen, [{ property: "implemented-by", kind: PropertyChangeKind.Set }]);
});

test("ignores changes to other nodes", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));
  graph.addNode(instance("vue", "technology"));
  const view = new ReactiveNode(graph, "react");
  const seen = watch(view);

  graph.setAttr("vue", "label", "Vue");

  assert.deepEqual(seen, []);
});

test("ignores structural (null-property) changes", () => {
  const graph = new Graph();
  graph.addNode(instance("shop", "application"));
  graph.addNode(instance("shop-web", "frontend"));
  const view = new ReactiveNode(graph, "shop");
  const seen = watch(view);

  graph.addEdge({ kind: EdgeKind.Contains, via: null, from: "shop", to: "shop-web" });

  assert.deepEqual(seen, []);
});

test("disposing stops notifications", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));
  const view = new ReactiveNode(graph, "react");
  const seen = watch(view);

  view.dispose();
  graph.setAttr("react", "label", "React");

  assert.deepEqual(seen, []);
});

test("constructing over an unknown node throws", () => {
  const graph = new Graph();
  assert.throws(() => new ReactiveNode(graph, "ghost"), /does not exist/i);
});

test("get reads a scalar attr and forward relationship targets by name", () => {
  const graph = new Graph();
  graph.addNode(instance("shop-web", "frontend"));
  graph.addNode(instance("react", "technology"));
  graph.setAttr("shop-web", "label", "Shop Web");
  graph.addEdge({ kind: EdgeKind.Relationship, via: "implemented-by", from: "shop-web", to: "react" });
  const view = new ReactiveNode(graph, "shop-web");

  assert.equal(view.get("label"), "Shop Web");
  assert.deepEqual(view.get("implemented-by"), ["react"]);
  assert.equal(view.get("missing"), undefined);
});
