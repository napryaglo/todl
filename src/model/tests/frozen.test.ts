import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { toJSON } from "../../emit/json.js";
import { FrozenRepository } from "../frozen.js";

// Build a small graph with the mutable Repository, serialize it, and reload it
// frozen. gw --implemented-by--> copilot; a <-> b via `peer` (a cycle).
function doc() {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("technology");
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "implemented-by", "copilot");
  b.assertInstance("component", "a");
  b.assertInstance("component", "b");
  b.addRelationship("a", "peer", "b");
  b.addRelationship("b", "peer", "a");
  b.commit();
  return toJSON(repo);
}

test("FrozenRepository reads scalars and references like a Repository", () => {
  const frozen = FrozenRepository.fromJSON(doc());
  assert.equal(frozen.attr("gw", "label"), "Gateway");
  assert.equal(frozen.ref("gw", "implemented-by"), "copilot");
  assert.equal(frozen.entity("gw")!.ref("implemented-by")!.id, "copilot");
});

test("entity handles are shared (identity map) and cycle-safe", () => {
  const frozen = FrozenRepository.fromJSON(doc());
  assert.equal(frozen.entity("gw"), frozen.entity("gw"));
  assert.equal(frozen.entity("gw")!.ref("implemented-by"), frozen.entity("copilot"));
  const a = frozen.entity("a")!;
  assert.equal(a.ref("peer")!.ref("peer"), a);
});

test("mutation is sealed: builder() throws", () => {
  const frozen = FrozenRepository.fromJSON(doc());
  assert.throws(() => frozen.builder(), /immutable/);
});

test("entity handles are frozen", () => {
  const frozen = FrozenRepository.fromJSON(doc());
  assert.equal(Object.isFrozen(frozen.entity("gw")), true);
});
