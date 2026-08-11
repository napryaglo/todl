import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../model.js";
import { Cardinality } from "../graph.js";

test("defineConcept builds the extends lattice, queryable and reflected", () => {
  const model = new Repository();
  model
    .builder()
    .defineConcept("component")
    .defineConcept("frontend", "component")
    .defineConcept("spa", "frontend")
    .commit();

  assert.deepEqual(new Set(model.supertypesOf("spa")), new Set(["frontend", "component"]));
  assert.equal(model.schemaOf("frontend").extends, "component");
});

test("addField and addConceptRelationship populate the concept schema", () => {
  const model = new Repository();
  model
    .builder()
    .definePrimitive("string")
    .defineConcept("location")
    .defineConcept("component")
    .addField("component", "label", "string")
    .addConceptRelationship("component", "in", ["location"], Cardinality.One)
    .commit();

  const schema = model.schemaOf("component");
  assert.deepEqual(schema.fields, [{ name: "label", type: "string", cardinality: Cardinality.One }]);
  assert.deepEqual(schema.relationships, [
    { name: "in", targets: ["location"], cardinality: Cardinality.One, inverse: null },
  ]);
});

test("addConceptRelationship records an inverse name when given", () => {
  const model = new Repository();
  model
    .builder()
    .defineConcept("location")
    .defineConcept("component")
    .addConceptRelationship("component", "in", ["location"], Cardinality.One, "hosts")
    .commit();

  assert.equal(model.schemaOf("component").relationships[0]?.inverse, "hosts");
});

test("a multi-valued field defaults and records its cardinality", () => {
  const model = new Repository();
  model
    .builder()
    .definePrimitive("location")
    .defineConcept("technology")
    .addField("technology", "availableIn", "location", Cardinality.Many)
    .commit();

  assert.equal(model.schemaOf("technology").fields[0]?.cardinality, Cardinality.Many);
});

test("schemaOf returns empty members for a bare concept", () => {
  const model = new Repository();
  model.builder().defineConcept("thing").commit();

  const schema = model.schemaOf("thing");
  assert.equal(schema.extends, null);
  assert.deepEqual(schema.fields, []);
  assert.deepEqual(schema.relationships, []);
});
