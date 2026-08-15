import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { toJSON, type TodlDocument } from "../json.js";
import { collectOperators, deriveBindings, emitModelTodl } from "../todl.js";

// Base: sequence { steps : step[] }, step { src, dst }, operator ==> : step(src,dst).
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

test("a field-bound reified edge emits as operator shorthand inside a list", () => {
  const model = base();
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  const b = model.builder();
  b.assertInstance("endpoint", "a");
  b.assertInstance("endpoint", "b");
  b.assertInstance("sequence", "sq");
  b.setField("sq", "id", "sq");
  b.assertInstance("step", "id-0");
  b.setField("id-0", "id", "id-0");
  b.addRelationship("id-0", "src", "a");
  b.addRelationship("id-0", "dst", "b");
  b.addContains("sq", "id-0");
  b.addRelationship("sq", "steps", "id-0");
  b.commit();

  const own: TodlDocument = { nodes: [], edges: [] };
  const full = toJSON(model);
  for (const n of full.nodes) if (!baseIds.has(n.id)) own.nodes.push(n);
  for (const e of full.edges) if (!baseIds.has(e.from)) own.edges.push(e);

  const out = emitModelTodl(own, "acme.app", deriveBindings(model, baseIds, "acme.app", own), undefined, collectOperators(model));
  assert.match(out, /a ==> b/, "shorthand in value position");
  assert.doesNotMatch(out, /step \{/, "not the inline-object form");
});
