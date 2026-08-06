import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { toJSON, type TodlDocument } from "../json.js";
import { deriveBindings, emitModelTodl } from "../todl.js";

// A namespaced meta-model base: concept `component` { label; implemented-by : technology }.
function base(): Repository {
  const r = new Repository();
  const b = r.builder().setNamespace("acme.ea");
  b.definePrimitive("string");
  b.defineConcept("technology");
  b.defineConcept("component");
  b.addField("component", "label", "string");
  b.addField("component", "implemented-by", "technology");
  b.commit();
  return r;
}

// Own delta: a component `gw` with a label + a cross-boundary ref to `copilot`.
function ownDoc(): { own: TodlDocument; model: Repository; baseIds: Set<string> } {
  const model = base();
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  const b = model.builder();
  b.assertInstance("technology", "copilot"); // pretend a library instance
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "implemented-by", "copilot");
  b.commit();
  const own: TodlDocument = { nodes: [], edges: [] };
  const full = toJSON(model);
  for (const n of full.nodes) if (!baseIds.has(n.id)) own.nodes.push(n);
  for (const e of full.edges) if (!baseIds.has(e.from)) own.edges.push(e);
  return { own, model, baseIds };
}

test("deriveBindings finds the meta-model namespace and drops own from imports", () => {
  const { own, model, baseIds } = ownDoc();
  const bindings = deriveBindings(model, baseIds, "acme.app", own);
  assert.equal(bindings.metaModel, "acme.ea");
  assert.deepEqual(bindings.imports, ["acme.ea"]);
});

test("emitModelTodl emits a namespace + model block with instances and references", () => {
  const { own, model, baseIds } = ownDoc();
  const bindings = deriveBindings(model, baseIds, "acme.app", own);
  const src = emitModelTodl(own, "acme.app", bindings);
  assert.match(src, /namespace acme\.app/);
  assert.match(src, /import acme\.ea;/);
  assert.match(src, /model acme-app-model : acme\.ea \{/);
  assert.match(src, /component gw \{/);
  assert.match(src, /label = "Gateway";/);
  assert.match(src, /implemented-by = copilot;/);
});

test("emitModelTodl degrades without base namespaces (fallback meta-model)", () => {
  const model = new Repository();
  const b = model.builder();
  b.defineConcept("component");
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  b.assertInstance("component", "gw");
  b.commit();
  const own: TodlDocument = { nodes: toJSON(model).nodes.filter((n) => !baseIds.has(n.id)), edges: [] };
  const bindings = deriveBindings(model, baseIds, "app", own);
  assert.equal(bindings.metaModel, "app"); // fallback to draft namespace
  const src = emitModelTodl(own, "app", bindings);
  assert.match(src, /model app-model : app \{/);
  assert.match(src, /component gw \{\}/);
});
