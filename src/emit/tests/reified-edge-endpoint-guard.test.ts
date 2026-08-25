import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { toJSON, type TodlDocument } from "../json.js";
import { collectOperators, deriveBindings, emitModelTodl } from "../todl.js";

// Base: step { src, dst }, operator ==> : step(src, dst) — a reified edge whose
// two endpoints are mandatory. Emitting a step that lost an endpoint (its ref
// target was undefined and dropped on load) must THROW, not silently degrade to
// `step { id }` — that silent degrade is the scenario-corruption data-loss bug.
function base(): Repository {
  const r = new Repository();
  const b = r.builder().setNamespace("acme.ea");
  b.definePrimitive("string");
  b.defineConcept("endpoint");
  b.addField("endpoint", "label", "string");
  b.defineConcept("step");
  b.addField("step", "src", "endpoint");
  b.addField("step", "dst", "endpoint");
  b.defineConcept("sequence");
  b.addField("sequence", "steps", "step");
  b.defineOperator("==>", "step", "src", "dst", null);
  b.commit();
  return r;
}

function ownDoc(model: Repository, baseIds: ReadonlySet<string>): TodlDocument {
  const own: TodlDocument = { nodes: [], edges: [] };
  const full = toJSON(model);
  for (const n of full.nodes) if (!baseIds.has(n.id)) own.nodes.push(n);
  for (const e of full.edges) if (!baseIds.has(String(e.from))) own.edges.push(e);
  return own;
}

function emit(model: Repository, baseIds: ReadonlySet<string>): string {
  const own = ownDoc(model, baseIds);
  return emitModelTodl(own, "acme.app", deriveBindings(model, baseIds, "acme.app", own), undefined, collectOperators(model));
}

test("a reified step missing its dst endpoint throws on emit (no silent step{} degrade)", () => {
  const model = base();
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  const b = model.builder();
  b.assertInstance("endpoint", "a");
  b.assertInstance("step", "id-0");
  b.setField("id-0", "id", "id-0");
  b.addRelationship("id-0", "src", "a"); // src bound, dst missing (its target was dropped)
  b.commit();

  assert.throws(() => emit(model, baseIds), /step.*id-0|endpoint|dst/i);
});

test("a reified step with BOTH endpoints still emits shorthand (no false positive)", () => {
  const model = base();
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  const b = model.builder();
  b.assertInstance("endpoint", "a");
  b.assertInstance("endpoint", "b");
  b.assertInstance("step", "id-0");
  b.setField("id-0", "id", "id-0");
  b.addRelationship("id-0", "src", "a");
  b.addRelationship("id-0", "dst", "b");
  b.commit();

  const out = emit(model, baseIds);
  assert.match(out, /a ==> b/);
});
