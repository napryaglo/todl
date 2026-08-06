import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { toJSON } from "../../emit/json.js";
import { FrozenRepository } from "../frozen.js";

function build(): Repository {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("app-component", "component");
  b.assertInstance("app-component", "gw");
  b.setField("gw", "label", "Gateway");
  b.commit();
  return repo;
}

test("memoized derived queries return the identical cached instance", () => {
  const frozen = FrozenRepository.fromJSON(toJSON(build()));
  assert.equal(frozen.effectiveFields("gw"), frozen.effectiveFields("gw"));
  assert.equal(frozen.effectiveRelationships("gw"), frozen.effectiveRelationships("gw"));
  assert.equal(frozen.effectiveSchema("app-component"), frozen.effectiveSchema("app-component"));
  assert.equal(frozen.supertypesOf("app-component"), frozen.supertypesOf("app-component"));
  assert.equal(frozen.subtypesOf("component"), frozen.subtypesOf("component"));
});

test("frozen results match a mutable Repository (memoization changes nothing observable)", () => {
  const mutable = build();
  const frozen = FrozenRepository.fromJSON(toJSON(build()));
  assert.deepEqual([...frozen.effectiveFields("gw")], [...mutable.effectiveFields("gw")]);
  assert.deepEqual(frozen.supertypesOf("app-component"), mutable.supertypesOf("app-component"));
  assert.equal(frozen.effectiveSchema("app-component").concept, "app-component");
  assert.equal(frozen.entity("gw")!.is("component"), true); // subtype via memoized supertypesOf
});

test("memoized ref-target arrays are frozen (no accidental mutation of the cache)", () => {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("technology");
  b.assertInstance("technology", "copilot");
  b.assertInstance("component", "gw");
  b.addRelationship("gw", "implementedBy", "copilot");
  b.commit();
  const frozen = FrozenRepository.fromJSON(toJSON(repo));
  const targets = frozen.effectiveRelationships("gw").get("implementedBy")!;
  assert.equal(Object.isFrozen(targets), true);
});
