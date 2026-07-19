import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../model.js";
import { Graph, Tier, EdgeKind } from "../graph.js";

test("builder builds instances resolvable through the model", () => {
  const model = new Repository();
  model.builder().assertInstance("technology", "react").setField("react", "label", "React").commit();

  assert.equal(model.has("react"), true);
  assert.equal(model.resolve("react")?.attrs.get("label"), "React");
  assert.deepEqual(model.instancesOf("technology"), ["react"]);
});

test("view returns a reactive facade wired to the model", () => {
  const model = new Repository();
  model.builder().assertInstance("technology", "react").commit();

  const view = model.view("react");
  let changed = "";
  view.propertyChanged.subscribe((args) => (changed = args.property));

  model.builder().setField("react", "label", "React").commit();

  assert.equal(changed, "label");
});

test("subtypesOf and supertypesOf walk the extends lattice", () => {
  const graph = new Graph();
  for (const id of ["component", "frontend", "spa"]) {
    graph.addNode({ id, tier: Tier.Ontology, typeOf: "concept", attrs: new Map() });
  }
  graph.addEdge({ kind: EdgeKind.Extends, via: null, from: "frontend", to: "component" });
  graph.addEdge({ kind: EdgeKind.Extends, via: null, from: "spa", to: "frontend" });
  const model = new Repository(graph);

  assert.deepEqual(new Set(model.supertypesOf("spa")), new Set(["frontend", "component"]));
  assert.deepEqual(new Set(model.subtypesOf("component")), new Set(["frontend", "spa"]));
});

test("changed exposes the model change stream", () => {
  const model = new Repository();
  const nodes: string[] = [];
  model.changed.subscribe((change) => nodes.push(change.node));

  model.builder().assertInstance("technology", "react").commit();

  assert.deepEqual(nodes, ["react"]);
});
