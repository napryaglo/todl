import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../model.js";
import { Graph, Tier, EdgeKind, Cardinality, type Node } from "../graph.js";
import {
  PropertyChangeKind,
  CollectionChangeKind,
  type PropertyChangedArgs,
  type CollectionChangedArgs,
} from "../reactive.js";

function instance(id: string, typeOf: string): Node {
  return { id, tier: Tier.Instance, typeOf, attrs: new Map() };
}

test("raises propertyChanged when a scalar attr is set", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));
  const model = new Model(graph);
  const view = model.view("react");
  const seen: PropertyChangedArgs[] = [];
  view.propertyChanged.subscribe((args) => seen.push(args));

  graph.setAttr("react", "label", "React");

  assert.deepEqual(seen, [{ property: "label", kind: PropertyChangeKind.Set }]);
});

test("raises propertyChanged for a single relationship with no schema entry", () => {
  const graph = new Graph();
  graph.addNode(instance("shop-web", "frontend"));
  graph.addNode(instance("react", "technology"));
  const model = new Model(graph);
  const view = model.view("shop-web");
  const seen: PropertyChangedArgs[] = [];
  view.propertyChanged.subscribe((args) => seen.push(args));

  graph.addEdge({ kind: EdgeKind.Relationship, via: "implemented-by", from: "shop-web", to: "react" });

  assert.deepEqual(seen, [{ property: "implemented-by", kind: PropertyChangeKind.Set }]);
});

test("routes a multi-valued relationship to collectionChanged with the item", () => {
  const model = new Model();
  model
    .builder()
    .defineConcept("location")
    .defineConcept("technology")
    .addConceptRelationship("technology", "available-in", "location", Cardinality.Many)
    .commit();
  model.builder().assertInstance("location", "m365").assertInstance("technology", "react").commit();

  const view = model.view("react");
  const collectionSeen: CollectionChangedArgs[] = [];
  const propertySeen: PropertyChangedArgs[] = [];
  view.collectionChanged.subscribe((args) => collectionSeen.push(args));
  view.propertyChanged.subscribe((args) => propertySeen.push(args));

  model.builder().addRelationship("react", "available-in", "m365").commit();

  assert.deepEqual(collectionSeen, [
    { property: "available-in", kind: CollectionChangeKind.Added, item: "m365" },
  ]);
  assert.deepEqual(propertySeen, []);
});

test("ignores changes to other nodes", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));
  graph.addNode(instance("vue", "technology"));
  const model = new Model(graph);
  const view = model.view("react");
  const seen: PropertyChangedArgs[] = [];
  view.propertyChanged.subscribe((args) => seen.push(args));

  graph.setAttr("vue", "label", "Vue");

  assert.deepEqual(seen, []);
});

test("ignores structural (null-property) changes", () => {
  const graph = new Graph();
  graph.addNode(instance("shop", "application"));
  graph.addNode(instance("shop-web", "frontend"));
  const model = new Model(graph);
  const view = model.view("shop");
  const propertySeen: PropertyChangedArgs[] = [];
  const collectionSeen: CollectionChangedArgs[] = [];
  view.propertyChanged.subscribe((args) => propertySeen.push(args));
  view.collectionChanged.subscribe((args) => collectionSeen.push(args));

  graph.addEdge({ kind: EdgeKind.Contains, via: null, from: "shop", to: "shop-web" });

  assert.deepEqual(propertySeen, []);
  assert.deepEqual(collectionSeen, []);
});

test("disposing stops notifications", () => {
  const graph = new Graph();
  graph.addNode(instance("react", "technology"));
  const model = new Model(graph);
  const view = model.view("react");
  const seen: PropertyChangedArgs[] = [];
  view.propertyChanged.subscribe((args) => seen.push(args));

  view.dispose();
  graph.setAttr("react", "label", "React");

  assert.deepEqual(seen, []);
});

test("constructing over an unknown node throws", () => {
  const model = new Model();
  assert.throws(() => model.view("ghost"), /does not exist/i);
});

test("get reads a scalar attr and forward relationship targets by name", () => {
  const graph = new Graph();
  graph.addNode(instance("shop-web", "frontend"));
  graph.addNode(instance("react", "technology"));
  graph.setAttr("shop-web", "label", "Shop Web");
  graph.addEdge({ kind: EdgeKind.Relationship, via: "implemented-by", from: "shop-web", to: "react" });
  const model = new Model(graph);
  const view = model.view("shop-web");

  assert.equal(view.get("label"), "Shop Web");
  assert.deepEqual(view.get("implemented-by"), ["react"]);
  assert.equal(view.get("missing"), undefined);
});
