import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository, EntityBase, type Entity } from "../../index.js";

// A meta-model-ish graph: concept `component`, taxonomy `component-category`
// (represents component) with term `ai-agent`, and an instance `gw` whose
// reference field `category` points at the term.
function fixture(): Repository {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineTaxonomy("component-category", ["component"], [
    { id: "ai-agent", attrs: new Map([["label", "AI Agent"]]) },
  ]);
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "category", "component-category.ai-agent");
  b.commit();
  return repo;
}

test("Entity and EntityBase are exported from the package root", () => {
  assert.equal(typeof EntityBase, "function");
  const gw: Entity | undefined = fixture().entity("gw");
  assert.ok(gw instanceof EntityBase);
});

test("a reference into a taxonomy term navigates to a class Entity with its fields", () => {
  const repo = fixture();
  const category = repo.entity("gw")!.ref("category")!;
  assert.equal(category.id, "component-category.ai-agent");
  assert.equal(category.field("label"), "AI Agent");
  // The term node is a class of `component`, so is() sees the represented concept.
  assert.equal(category.is("component"), true);
});

test("the whole read surface composes: fields, refs, and reverse navigation", () => {
  const repo = fixture();
  const gw = repo.entity("gw")!;
  assert.equal(gw.field("label"), "Gateway");
  assert.deepEqual(gw.refs("category").map((e) => e.id), ["component-category.ai-agent"]);
  const term = repo.entity("component-category.ai-agent")!;
  assert.deepEqual(term.referrers("category").map((e) => e.id), ["gw"]);
});
