import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, ValueKind, type TaxonomyDecl } from "../ast.js";

function taxonomy(src: string): TaxonomyDecl {
  const { namespace } = parse(`namespace n {\n${src}\n}`, "t.todl");
  const decl = namespace.declarations.find((d) => d.kind === DeclKind.Taxonomy);
  assert.ok(decl, "expected a taxonomy declaration");
  return decl as TaxonomyDecl;
}

test("flat taxonomy parses represents + terms as classes of the concept", () => {
  const t = taxonomy(`taxonomy color : represents hue { term red { label = "Red"; } term blue { label = "Blue"; } }`);
  assert.equal(t.name, "color");
  assert.deepEqual(t.represents, ["hue"]);
  assert.deepEqual(t.terms.map((x) => x.id), ["red", "blue"]);
  const red = t.terms[0];
  assert.ok(red);
  assert.equal(red.concept, null); // bare `term` alias — concept inferred
  const label = red.assignments.find((a) => a.name === "label");
  assert.ok(label && label.value.kind === ValueKind.String);
  assert.equal(label.value.text, "Red");
  assert.deepEqual(red.children, []);
});

test("multi-representation taxonomy parses a represents list and concept-led terms", () => {
  const t = taxonomy(`taxonomy microsoft : represents location, technology {
    location azure          { label = "Azure"; }
    technology azure-openai { label = "Azure OpenAI"; }
  }`);
  assert.equal(t.name, "microsoft");
  assert.deepEqual(t.represents, ["location", "technology"]);
  assert.deepEqual(t.terms.map((x) => x.id), ["azure", "azure-openai"]);
  assert.equal(t.terms[0]?.concept, "location");
  assert.equal(t.terms[1]?.concept, "technology");
  const label = t.terms[1]?.assignments.find((a) => a.name === "label");
  assert.ok(label && label.value.kind === ValueKind.String);
  assert.equal(label.value.text, "Azure OpenAI");
});

test("concept-led terms nest and carry their concept at each depth", () => {
  const t = taxonomy(`taxonomy cloud : represents location {
    location region { label = "Region"; location zone { label = "Zone"; } }
  }`);
  assert.deepEqual(t.represents, ["location"]);
  assert.equal(t.terms[0]?.concept, "location");
  assert.deepEqual(t.terms[0]?.children.map((c) => c.id), ["zone"]);
  assert.equal(t.terms[0]?.children[0]?.concept, "location");
});

test("nested taxonomy parses child terms mixed with assignments", () => {
  const t = taxonomy(`taxonomy cc : represents category {
    term surface { label = "Surface"; term api-service { label = "API"; } term web-portal {} }
    term data-store {}
  }`);
  assert.deepEqual(t.represents, ["category"]);
  assert.deepEqual(t.terms.map((x) => x.id), ["surface", "data-store"]);
  const surface = t.terms[0];
  const dataStore = t.terms[1];
  assert.ok(surface);
  assert.ok(dataStore);
  const label = surface.assignments.find((a) => a.name === "label");
  assert.ok(label && label.value.kind === ValueKind.String);
  assert.equal(label.value.text, "Surface");
  assert.deepEqual(surface.children.map((c) => c.id), ["api-service", "web-portal"]);
  assert.deepEqual(dataStore.children, []);
});
