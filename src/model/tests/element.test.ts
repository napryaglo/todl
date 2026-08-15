import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { toJSON, graphFromJSON } from "../../emit/json.js";
import { load } from "../../parse/loader.js";
import { ModelDraft } from "../../authoring/model-draft.js";
import { toElement } from "../element.js";

const MM = `namespace t {
  concept category {}
  concept technology { relationship partOf -> technology; }
  concept component {
    name : string;
    relationship hostedIn -> technology;
    relationship categorisedAs -> category;
    relationship implementedBy -> technology;
    relationship linkedTo -> component;
  }
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term cloud {}  term azure { partOf = Stack.cloud; } }
  viewpoint V : frames component
}`;

const MODEL = `namespace t {
  model M : t conforms V {
    component c1 { name = "C One"; hostedIn = Stack.cloud; categorisedAs = Cats.ai; implementedBy = Stack.azure; }
    component c2 { name = "C Two"; }
  }
}`;

function setup() {
  const base = new Repository(graphFromJSON(toJSON(load([{ uri: "mm.todl", text: MM }]).model)));
  const draft = ModelDraft.fromSources([base], [{ uri: "a.todl", text: MODEL }], { namespace: "t" });
  draft.addRef("c1", "linkedTo", "c2");
  draft.addRef("c2", "linkedTo", "c1");
  draft.setField("c1", "conforms", "V");
  const repo = draft.model;
  const entity = (id: string) => draft.ownInstances().find((e) => e.id === id)!;
  return { repo, draft, entity };
}

test("core: id/concept/fields and resolved refs", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  assert.equal(el.id, "c1");
  assert.equal(el.concept, "component");
  assert.equal(el.fields.name, "C One");
  assert.equal(el.refs.categorisedAs[0].id, "Cats.ai");
  assert.equal(el.refs.categorisedAs[0].concept, "category");
});

test("empty relationship members are omitted from refs", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  const c2 = el.refs.linkedTo[0];
  assert.equal(c2.id, "c2");
  assert.equal(c2.refs.categorisedAs, undefined); // c2 has no categorisedAs
});

test("deep nesting resolves aggregates inline", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  const azure = el.refs.implementedBy[0];
  assert.equal(azure.id, "Stack.azure");
  assert.equal(azure.refs.partOf[0].id, "Stack.cloud"); // one level deeper
});

test("cycle guard: a back-reference is truncated with empty refs", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  const back = el.refs.linkedTo[0].refs.linkedTo[0]; // c2 -> c1 (already expanded)
  assert.equal(back.id, "c1");
  assert.equal(back.truncated, true);
  assert.equal(Object.keys(back.refs).length, 0);
});

test("maxDepth cuts recursion without marking truncated", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"), { maxDepth: 1 });
  const azure = el.refs.implementedBy[0]; // depth 1
  assert.equal(Object.keys(azure.refs).length, 0); // partOf not expanded
  assert.equal(azure.truncated, undefined); // depth cut, not a cycle
});

test("schema facet mirrors the concept's declared members", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  assert.equal(el.schema.concept, "component");
  assert.ok(el.schema.fields.some((f) => f.name === "name"));
  const cat = el.schema.relationships.find((r) => r.name === "categorisedAs");
  assert.ok(cat && cat.targets.includes("category"));
});

test("provenance: conforms from attrs, home from injected homeOf", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"), { homeOf: (id) => (id === "c1" ? "application.todl" : undefined) });
  assert.equal(el.provenance.conforms, "V");
  assert.equal(el.provenance.home, "application.todl");
});

test("referredBy is present on the root and absent on nested nodes", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  assert.ok(el.referredBy!.some((r) => r.id === "c2" && r.via === "linkedTo"));
  assert.equal(el.refs.implementedBy[0].referredBy, undefined); // nested aggregate
});

test("presentation: default label, and injected resolver wins", () => {
  const { repo, entity } = setup();
  const plain = toElement(repo, entity("c1"));
  assert.equal(plain.presentation.label, "C One");
  assert.equal(plain.presentation.iconKey, undefined);

  const injected = toElement(repo, entity("c1"), {
    presentation: (e, def) => ({ label: def.toUpperCase(), iconKey: `k_${e.concept}` }),
  });
  assert.equal(injected.presentation.label, "C ONE");
  assert.equal(injected.presentation.iconKey, "k_component");
  assert.equal(injected.refs.implementedBy[0].presentation.iconKey, "k_technology"); // applied deep
});
