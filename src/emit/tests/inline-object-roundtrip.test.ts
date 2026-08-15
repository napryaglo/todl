import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { toJSON, type TodlDocument } from "../json.js";
import { deriveBindings, emitModelTodl } from "../todl.js";

// A meta-model base: concept `slot { environment }` and `component { slots : slot[] }`.
function base(): Repository {
  const r = new Repository();
  const b = r.builder().setNamespace("acme.ea");
  b.definePrimitive("string");
  b.defineConcept("slot");
  b.addField("slot", "environment", "string");
  b.defineConcept("component");
  b.addField("component", "slots", "slot");
  b.commit();
  return r;
}

// Own delta as the loader materialises an inline object: c1 contains slot `id-0`,
// bound via the `slots` field.
function emit(): string {
  const model = base();
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  const b = model.builder();
  b.assertInstance("component", "c1");
  b.assertInstance("slot", "id-0");
  b.setField("id-0", "id", "id-0");
  b.setField("id-0", "environment", "prod");
  b.addContains("c1", "id-0");
  b.addRelationship("c1", "slots", "id-0");
  b.commit();

  const own: TodlDocument = { nodes: [], edges: [] };
  const full = toJSON(model);
  for (const n of full.nodes) if (!baseIds.has(n.id)) own.nodes.push(n);
  for (const e of full.edges) if (!baseIds.has(e.from)) own.edges.push(e);

  const bindings = deriveBindings(model, baseIds, "acme.app", own);
  return emitModelTodl(own, "acme.app", bindings);
}

test("a field-bound inline object emits inline with its id, not flattened", () => {
  const out = emit();
  assert.match(out, /slots\s*=\s*slot\s*\{/, "inline form");
  assert.match(out, /id-0/, "id persisted");
  assert.match(out, /environment = "prod";/, "nested attr emitted");
  assert.doesNotMatch(out, /^\s*slot id-0 \{/m, "not a flattened top-level record");
});
