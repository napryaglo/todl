import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { Cardinality } from "../../model/graph.js";
import { DiagnosticCode } from "../validate.js";

/** technology { label: string [one]; available-in -> location [non-empty] }. */
function schemaModel(): Repository {
  const model = new Repository();
  model
    .builder()
    .definePrimitive("string")
    .defineConcept("location")
    .defineConcept("technology")
    .addField("technology", "label", "string", Cardinality.One)
    .addConceptRelationship("technology", "availableIn", "location", Cardinality.NonEmpty)
    .commit();
  return model;
}

test("a fully-populated instance produces no diagnostics", () => {
  const model = schemaModel();
  model
    .builder()
    .assertInstance("location", "browser")
    .assertInstance("technology", "react")
    .setField("react", "label", "React")
    .addRelationship("react", "availableIn", "browser")
    .commit();

  assert.deepEqual(model.validate(), []);
});

test("a missing required scalar field is reported", () => {
  const model = schemaModel();
  model
    .builder()
    .assertInstance("location", "browser")
    .assertInstance("technology", "react")
    .addRelationship("react", "availableIn", "browser")
    .commit();

  const diagnostics = model.validate();
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, DiagnosticCode.RequiredMissing);
  assert.equal(diagnostics[0]?.path, "Technology.Label");
  assert.equal(diagnostics[0]?.node, "react");
});

test("an empty non-empty relationship is reported", () => {
  const model = schemaModel();
  model.builder().assertInstance("technology", "react").setField("react", "label", "React").commit();

  const diagnostics = model.validate();
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, DiagnosticCode.EmptyNotAllowed);
  assert.equal(diagnostics[0]?.path, "Technology.availableIn");
});

test("inherited fields are validated on subtype instances", () => {
  const model = new Repository();
  model
    .builder()
    .definePrimitive("string")
    .defineConcept("component")
    .addField("component", "label", "string", Cardinality.One)
    .defineConcept("frontend", "component")
    .commit();
  model.builder().assertInstance("frontend", "shop-web").commit(); // missing inherited label

  const diagnostics = model.validate();
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, DiagnosticCode.RequiredMissing);
  assert.equal(diagnostics[0]?.path, "frontend.Label");
});
