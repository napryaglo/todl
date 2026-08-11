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
    .addConceptRelationship("technology", "availableIn", ["location"], Cardinality.Many)
    .defineConcept("component")
    .addConceptRelationship("component", "in", ["location"], Cardinality.One)
    .addConceptRelationship("component", "implementedBy", ["technology"], Cardinality.Optional)
    .commit();

  model.defineInvariant(
    "component",
    implies(
      neq(member(THIS, "implementedBy"), NONE),
      isIn(member(THIS, "in"), member(member(THIS, "implementedBy"), "availableIn")),
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
    .addRelationship("teams", "availableIn", "m365")
    .assertInstance("component", "teamsChat")
    .addRelationship("teamsChat", "in", "m365")
    .addRelationship("teamsChat", "implementedBy", "teams")
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
    .addRelationship("teams", "availableIn", "m365") // not aws
    .assertInstance("component", "teamsChat")
    .addRelationship("teamsChat", "in", "aws")
    .addRelationship("teamsChat", "implementedBy", "teams")
    .commit();

  const diagnostics = invariantDiagnostics(model);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.node, "teamsChat");
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
    .addRelationship("teams", "availableIn", "m365")
    .assertInstance("frontend", "web")
    .addRelationship("web", "in", "aws")
    .addRelationship("web", "implementedBy", "teams")
    .commit();

  assert.equal(invariantDiagnostics(model).some((diagnostic) => diagnostic.node === "web"), true);
});
