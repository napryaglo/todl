import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../graph.js";
import { Repository } from "../model.js";
import { MetaKind } from "../kinds.js";

function built() {
  const repo = new Repository(new Graph());
  const b = repo.builder();
  b.defineConcept("Component");
  b.defineConcept("Interface");
  b.defineConcept("WebComponent", "Component"); // WebComponent extends Component
  b.defineViewpoint("ComponentView", ["Component", "Interface"]);
  b.commit();
  return repo;
}

test("a viewpoint node is ontology-typed MetaKind.Viewpoint", () => {
  const repo = built();
  assert.equal(repo.resolve("ComponentView")?.typeOf, MetaKind.Viewpoint);
});

test("frames() returns the framed concepts; framedBy() is the inverse", () => {
  const repo = built();
  assert.deepEqual(repo.frames("ComponentView").sort(), ["Component", "Interface"]);
  assert.deepEqual(repo.framedBy("Component"), ["ComponentView"]);
  assert.deepEqual(repo.framedBy("Interface"), ["ComponentView"]);
});

test("viewpoints() lists every viewpoint", () => {
  const repo = built();
  assert.deepEqual(repo.viewpoints(), ["ComponentView"]);
});

test("viewpointsFraming() is subtype-aware: a subtype of a framed concept is framed", () => {
  const repo = built();
  // WebComponent is not framed directly, but its supertype Component is.
  assert.deepEqual(repo.framedBy("WebComponent"), []);
  assert.deepEqual(repo.viewpointsFraming("WebComponent"), ["ComponentView"]);
  assert.deepEqual(repo.viewpointsFraming("Component"), ["ComponentView"]);
});
