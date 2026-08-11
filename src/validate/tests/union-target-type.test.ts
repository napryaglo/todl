import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { Cardinality } from "../../model/graph.js";
import { DiagnosticCode } from "../validate.js";

/** edge { end -> actor | component }, with ai_agent : actor. */
function baseModel(): Repository {
  const model = new Repository();
  model
    .builder()
    .defineConcept("actor")
    .defineConcept("component")
    .defineConcept("location")
    .defineConcept("ai_agent", "actor")
    .defineConcept("edge")
    .addConceptRelationship("edge", "end", ["actor", "component"], Cardinality.Many)
    .commit();
  return model;
}

function targetTypeDiagnostics(model: Repository) {
  return model.validate().filter((d) => d.code === DiagnosticCode.TargetTypeMismatch);
}

test("an instance target matching either union member passes", () => {
  const model = baseModel();
  model
    .builder()
    .assertInstance("actor", "alice")
    .assertInstance("component", "web")
    .assertInstance("edge", "e1")
    .addRelationship("e1", "end", "alice")
    .assertInstance("edge", "e2")
    .addRelationship("e2", "end", "web")
    .commit();

  assert.deepEqual(targetTypeDiagnostics(model), []);
});

test("a subtype of a union member passes (is-a preserved)", () => {
  const model = baseModel();
  model
    .builder()
    .assertInstance("ai_agent", "copilot")
    .assertInstance("edge", "e1")
    .addRelationship("e1", "end", "copilot")
    .commit();

  assert.deepEqual(targetTypeDiagnostics(model), []);
});

test("a target outside the union is a single mismatch naming all members", () => {
  const model = baseModel();
  model
    .builder()
    .assertInstance("location", "m365")
    .assertInstance("edge", "e1")
    .addRelationship("e1", "end", "m365")
    .commit();

  const diagnostics = targetTypeDiagnostics(model);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.node, "e1");
  assert.equal(diagnostics[0]?.path, "edge.end");
  assert.match(diagnostics[0]?.message ?? "", /actor \| component/);
});

test("effectiveSchema returns targets in author order from Targets edges", () => {
  const model = baseModel();
  const end = model.effectiveSchema("edge").relationships.find((r) => r.name === "end");
  assert.deepEqual(end?.targets, ["actor", "component"]);
});
