import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { FrozenRepository } from "../../model/frozen.js";
import { Cardinality } from "../../model/graph.js";
import { toJSON } from "../../emit/json.js";
import { ModelDraft } from "../model-draft.js";

// A tiny meta-model base: concept `component` with a scalar `label` and a
// reference field `implementedBy : Technology`; concept `technology`; plus a
// library instance `copilot` (a technology) to reference across the boundary.
function baseClient(): FrozenRepository {
  const repo = new Repository();
  const b = repo.builder();
  b.definePrimitive("string");
  b.defineConcept("technology");
  b.addField("technology", "label", "string");
  b.defineConcept("component");
  b.addField("component", "label", "string");
  b.addField("component", "implementedBy", "technology", Cardinality.Optional);
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.commit();
  return FrozenRepository.fromJSON(toJSON(repo));
}

test("on() builds a working model that resolves base nodes", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  assert.equal(draft.has("component"), true); // base concept
  assert.equal(draft.has("copilot"), true); // base instance
  assert.equal(draft.entity("copilot")!.field("label"), "Copilot");
  assert.equal(draft.has("nope"), false);
});

test("add stages an instance with a scalar and a cross-boundary reference", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  const gw = draft.add({
    concept: "component",
    id: "gw",
    scalars: new Map([["label", "Gateway"]]),
    refs: new Map([["implementedBy", ["copilot"]]]),
  });
  assert.equal(gw.field("label"), "Gateway");
  // the reference resolves across the boundary to the frozen base instance
  assert.equal(gw.ref("implementedBy")!.id, "copilot");
  assert.equal(gw.ref("implementedBy"), draft.entity("copilot"));
});

test("add supports own->own references", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  draft.add({ concept: "technology", id: "custom", scalars: new Map([["label", "Custom"]]) });
  const gw = draft.add({
    concept: "component",
    id: "gw",
    refs: new Map([["implementedBy", ["custom"]]]),
  });
  assert.equal(gw.ref("implementedBy")!.id, "custom");
});

test("ownInstances lists only overlay instances, not base nodes", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  draft.add({ concept: "component", id: "gw", scalars: new Map([["label", "Gateway"]]) });
  assert.deepEqual(draft.ownInstances().map((e) => e.id), ["gw"]);
});

test("diagnostics is clean for a valid overlay", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  draft.add({
    concept: "component",
    id: "gw",
    scalars: new Map([["label", "Gateway"]]),
    refs: new Map([["implementedBy", ["copilot"]]]),
  });
  assert.deepEqual(draft.diagnostics, []);
});

test("add throws when a reference target does not exist (fail-fast, no dangling)", () => {
  const draft = ModelDraft.on([baseClient()], { namespace: "app" });
  assert.throws(
    () => draft.add({ concept: "component", id: "gw", refs: new Map([["implementedBy", ["ghost"]]]) }),
    /ghost/,
  );
});
