import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { Cardinality } from "../../model/graph.js";
import { DiagnosticCode } from "../validate.js";
import { THIS, NONE, member, implies, neq, isIn } from "../../predicate/ast.js";

/** component with the "location covered by implementing tech" invariant. */
function coveredModel(): Repository {
  const model = new Repository();
  model
    .builder()
    .defineConcept("location")
    .defineConcept("technology")
    .addConceptRelationship("technology", "available-in", "location", Cardinality.Many)
    .defineConcept("component")
    .addConceptRelationship("component", "in", "location", Cardinality.One)
    .addConceptRelationship("component", "implemented-by", "technology", Cardinality.Optional)
    .commit();

  model.defineInvariant(
    "component",
    implies(
      neq(member(THIS, "implemented-by"), NONE),
      isIn(member(THIS, "in"), member(member(THIS, "implemented-by"), "available-in")),
    ),
    "location must be offered by the implementing technology",
  );
  return model;
}

function invariantDiagnostics(model: Repository) {
  return model.validate().filter((diagnostic) => diagnostic.code === DiagnosticCode.InvariantFailed);
}

test("a satisfying instance raises no invariant diagnostic", () => {
  const model = coveredModel();
  model
    .builder()
    .assertInstance("location", "m365")
    .assertInstance("technology", "teams")
    .addRelationship("teams", "available-in", "m365")
    .assertInstance("component", "teams-chat")
    .addRelationship("teams-chat", "in", "m365")
    .addRelationship("teams-chat", "implemented-by", "teams")
    .commit();

  assert.deepEqual(invariantDiagnostics(model), []);
});

test("a violating instance is reported with the invariant description", () => {
  const model = coveredModel();
  model
    .builder()
    .assertInstance("location", "m365")
    .assertInstance("location", "aws")
    .assertInstance("technology", "teams")
    .addRelationship("teams", "available-in", "m365") // not aws
    .assertInstance("component", "teams-chat")
    .addRelationship("teams-chat", "in", "aws")
    .addRelationship("teams-chat", "implemented-by", "teams")
    .commit();

  const diagnostics = invariantDiagnostics(model);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.node, "teams-chat");
  assert.match(diagnostics[0]?.message ?? "", /location must be offered/);
});

test("invariants are inherited by subtype instances", () => {
  const model = coveredModel();
  model.builder().defineConcept("frontend", "component").commit();
  model
    .builder()
    .assertInstance("location", "m365")
    .assertInstance("location", "aws")
    .assertInstance("technology", "teams")
    .addRelationship("teams", "available-in", "m365")
    .assertInstance("frontend", "web")
    .addRelationship("web", "in", "aws")
    .addRelationship("web", "implemented-by", "teams")
    .commit();

  assert.equal(invariantDiagnostics(model).some((diagnostic) => diagnostic.node === "web"), true);
});
