import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { FrozenRepository } from "../../model/frozen.js";
import { Cardinality } from "../../model/graph.js";
import { toJSON } from "../../emit/json.js";
import { mergeBases } from "../../api.js";
import { ModelDraft, type InstanceDescriptor } from "../../index.js";

function baseClient(): FrozenRepository {
  const repo = new Repository();
  const b = repo.builder();
  b.definePrimitive("string");
  b.defineConcept("technology");
  b.addField("technology", "label", "string");
  b.defineConcept("component");
  b.addField("component", "label", "string");
  b.addField("component", "implemented-by", "technology", Cardinality.Optional);
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.commit();
  return FrozenRepository.fromJSON(toJSON(repo));
}

function draftWithGw() {
  const base = baseClient();
  const draft = ModelDraft.on([base], { namespace: "app" });
  draft.add({
    concept: "component",
    id: "gw",
    scalars: new Map([["label", "Gateway"]]),
    refs: new Map([["implemented-by", ["copilot"]]]),
  });
  return { base, draft };
}

test("toJSON emits only the own delta — base nodes are not copied in", () => {
  const { draft } = draftWithGw();
  const delta = draft.toJSON();
  assert.deepEqual(delta.nodes.map((n) => n.id), ["gw"]);
  assert.equal(delta.nodes.find((n) => n.id === "copilot"), undefined);
});

test("the delta records the cross-boundary edge by target id", () => {
  const { draft } = draftWithGw();
  const delta = draft.toJSON();
  const edge = delta.edges.find((e) => e.from === "gw" && e.via === "implemented-by");
  assert.ok(edge);
  assert.equal(edge!.to, "copilot"); // frozen base id, referenced not copied
});

test("delta + base recompose into the full model", () => {
  const { base, draft } = draftWithGw();
  const recomposed = new Repository(mergeBases([toJSON(base), draft.toJSON()]));
  assert.equal(recomposed.entity("gw")!.field("label"), "Gateway");
  assert.equal(recomposed.entity("gw")!.ref("implemented-by")!.id, "copilot");
});

// InstanceDescriptor is usable as a type from the package root.
const _descriptor: InstanceDescriptor = { concept: "component", id: "x" };
void _descriptor;
