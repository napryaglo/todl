import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";

// A small instance graph: a `component` gw whose reference field `implemented-by`
// points at a `technology` copilot; plus a `component` class `web-app` with a
// fixed `label` and an instance `portal` that `instanceof` it.
function fixture(): Repository {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("technology");
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "implementedBy", "copilot");
  b.assertInstance("component", "webApp", true); // asClass
  b.setField("webApp", "label", "Web App default");
  b.assertInstance("component", "portal");
  b.addInstanceOf("portal", "webApp");
  b.commit();
  return repo;
}

test("attr reads a scalar field; missing attr and missing node are undefined", () => {
  const repo = fixture();
  assert.equal(repo.attr("gw", "label"), "Gateway");
  assert.equal(repo.attr("gw", "nope"), undefined);
  assert.equal(repo.attr("ghost", "label"), undefined);
});

test("attr is class-merged: a class's fixed value wins for an instanceof leaf", () => {
  const repo = fixture();
  assert.equal(repo.attr("portal", "label"), "Web App default");
});

test("ref returns the single relationship target; refs returns all; absent is undefined/[]", () => {
  const repo = fixture();
  assert.equal(repo.ref("gw", "implementedBy"), "copilot");
  assert.deepEqual(repo.refs("gw", "implementedBy"), ["copilot"]);
  assert.equal(repo.ref("gw", "none"), undefined);
  assert.deepEqual(repo.refs("gw", "none"), []);
});

test("referrers returns inbound relationship sources, optionally filtered by member", () => {
  const repo = fixture();
  assert.deepEqual(repo.referrers("copilot", "implementedBy"), ["gw"]);
  assert.deepEqual(repo.referrers("copilot"), ["gw"]);
  assert.deepEqual(repo.referrers("copilot", "other"), []);
});

test("danglingRefs is empty for a well-formed graph (positive case is Phase 4)", () => {
  const repo = fixture();
  assert.deepEqual(repo.danglingRefs(), []);
});
