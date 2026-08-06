import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { toJSON } from "../../emit/json.js";
import { FrozenRepository } from "../frozen.js";
import { FrozenRepository as FrozenFromRoot, type Entity } from "../../index.js";

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
  b.addRelationship("gw", "implementedBy", "copilot");
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
  assert.equal(frozen.ref("gw", "implementedBy"), "copilot");
  assert.equal(frozen.entity("gw")!.ref("implementedBy")!.id, "copilot");
});

test("entity handles are shared (identity map) and cycle-safe", () => {
  const frozen = FrozenRepository.fromJSON(doc());
  assert.equal(frozen.entity("gw"), frozen.entity("gw"));
  assert.equal(frozen.entity("gw")!.ref("implementedBy"), frozen.entity("copilot"));
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

// ── Hand-written client shape (validates the Component C shape pre-codegen) ──

// A hand-written package class: the shape Phase 3 codegen will emit. A collection
// accessor per concept; entity reads via the inherited typed primitives.
class TechCatalog extends FrozenFromRoot {
  get technologies(): Entity[] {
    return this.instancesOf("technology").map((id) => this.entity(id)!);
  }
  get components(): Entity[] {
    return this.instancesOf("component").map((id) => this.entity(id)!);
  }
}

test("FrozenRepository is exported from the package root", () => {
  assert.equal(typeof FrozenFromRoot, "function");
});

test("a hand-written client exposes concept collections of typed entities", () => {
  const catalog = TechCatalog.fromJSON(doc());
  assert.deepEqual(catalog.technologies.map((e) => e.id), ["copilot"]);
  assert.equal(catalog.technologies[0]!.field("label"), "Copilot");
  assert.deepEqual(catalog.components.map((e) => e.id).sort(), ["a", "b", "gw"]);
  assert.equal(catalog.entity("gw")!.ref("implementedBy"), catalog.entity("copilot"));
});
