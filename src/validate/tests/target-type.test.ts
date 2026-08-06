import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { Cardinality } from "../../model/graph.js";
import { DiagnosticCode } from "../validate.js";

/** component { in -> location [one] }. */
function baseModel(): Repository {
  const model = new Repository();
  model
    .builder()
    .defineConcept("location")
    .defineConcept("technology")
    .defineConcept("component")
    .addConceptRelationship("component", "in", "location", Cardinality.One)
    .commit();
  return model;
}

function targetTypeDiagnostics(model: Repository) {
  return model.validate().filter((diagnostic) => diagnostic.code === DiagnosticCode.TargetTypeMismatch);
}

test("a relationship pointing at the wrong concept is reported", () => {
  const model = baseModel();
  model
    .builder()
    .assertInstance("technology", "react")
    .assertInstance("component", "web")
    .addRelationship("web", "in", "react") // in expects a location
    .commit();

  const diagnostics = targetTypeDiagnostics(model);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.node, "web");
  assert.equal(diagnostics[0]?.path, "Component.in");
});

test("a correctly-typed relationship produces no diagnostic", () => {
  const model = baseModel();
  model
    .builder()
    .assertInstance("location", "m365")
    .assertInstance("component", "web")
    .addRelationship("web", "in", "m365")
    .commit();

  assert.deepEqual(targetTypeDiagnostics(model), []);
});

test("a relationship pointing at a subtype of the declared target is allowed", () => {
  const model = new Repository();
  model
    .builder()
    .defineConcept("location")
    .defineConcept("cloud-region", "location")
    .defineConcept("component")
    .addConceptRelationship("component", "in", "location", Cardinality.One)
    .commit();
  model
    .builder()
    .assertInstance("cloud-region", "aws-use1")
    .assertInstance("component", "web")
    .addRelationship("web", "in", "aws-use1")
    .commit();

  assert.deepEqual(targetTypeDiagnostics(model), []);
});
