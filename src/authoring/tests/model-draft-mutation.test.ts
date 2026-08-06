import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { ModelDraft } from "../model-draft.js";

// Meta-model base : concept `component { label : string; impl : Technology }`.
function base(): Repository {
  const r = new Repository();
  const b = r.builder().setNamespace("ea");
  b.definePrimitive("string");
  b.defineConcept("technology");
  b.defineConcept("component");
  b.addField("component", "label", "string");
  b.addField("component", "impl", "technology");
  b.commit();
  return r;
}

test("create + setField + addRef/removeRef + remove mutate the overlay", () => {
  const d = ModelDraft.on([base()], { namespace: "app" });
  d.create("technology", "t1");
  d.create("component", "gw");
  d.setField("gw", "label", "Gateway");
  assert.equal(d.entity("gw")!.field("label"), "Gateway");
  d.addRef("gw", "impl", "t1");
  assert.deepEqual(d.entity("gw")!.refs("impl").map((e) => e.id), ["t1"]);
  d.removeRef("gw", "impl", "t1");
  assert.deepEqual(d.entity("gw")!.refs("impl"), []);
  d.remove("t1");
  assert.equal(d.has("t1"), false);
  assert.deepEqual(d.ownInstances().map((e) => e.id).sort(), ["gw"]);
});

test("addRef to a missing target throws; setField/remove on a base id throws", () => {
  const d = ModelDraft.on([base()], { namespace: "app" });
  d.create("component", "gw");
  assert.throws(() => d.addRef("gw", "impl", "ghost"));
  assert.throws(() => d.setField("component", "label", "x")); // base id, frozen
  assert.throws(() => d.remove("component")); // base id, frozen
});

test("fromSource reopens a saved model as an editable draft (round-trip)", () => {
  const d1 = ModelDraft.on([base()], { namespace: "app" });
  d1.create("technology", "t1");
  d1.create("component", "gw");
  d1.setField("gw", "label", "Gateway");
  d1.addRef("gw", "impl", "t1"); // fill the required field so the model is valid
  const src = d1.toTodl();

  const d2 = ModelDraft.fromSource([base()], src, { namespace: "app" });
  assert.deepEqual(d2.ownInstances().map((e) => e.id).sort(), ["gw", "t1"]);
  assert.equal(d2.entity("gw")!.field("label"), "Gateway");
  assert.deepEqual(d2.entity("gw")!.refs("impl").map((e) => e.id), ["t1"]);
  assert.deepEqual(d2.diagnostics, []);
  d2.setField("gw", "label", "GW2"); // still editable
  assert.equal(d2.entity("gw")!.field("label"), "GW2");
});

test("fromSource of a blank source yields an empty draft", () => {
  assert.deepEqual(ModelDraft.fromSource([base()], "  ", { namespace: "app" }).ownInstances(), []);
});

test("referenceMembers returns concept-typed fields a target can fill", () => {
  const d = ModelDraft.on([base()], { namespace: "app" });
  d.create("component", "gw");
  d.create("technology", "t1");
  assert.deepEqual(d.referenceMembers("gw", "t1").map((f) => f.name), ["impl"]); // "label" (string) excluded
});
