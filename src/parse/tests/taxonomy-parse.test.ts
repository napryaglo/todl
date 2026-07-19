import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type TaxonomyDecl } from "../ast.js";

function taxonomy(src: string): TaxonomyDecl {
  const { namespace } = parse(`namespace n {\n${src}\n}`, "t.todl");
  const decl = namespace.declarations.find((d) => d.kind === DeclKind.Taxonomy);
  assert.ok(decl, "expected a taxonomy declaration");
  return decl as TaxonomyDecl;
}

test("flat taxonomy parses terms with label/description", () => {
  const t = taxonomy(`taxonomy color { terms { | red { label = "Red"; } | blue { label = "Blue"; } } }`);
  assert.equal(t.name, "color");
  assert.deepEqual(t.terms.map((x) => x.id), ["red", "blue"]);
  const red = t.terms[0];
  assert.ok(red);
  assert.equal(red.label, "Red");
  assert.deepEqual(red.children, []);
});

test("nested taxonomy parses child terms mixed with attributes", () => {
  const t = taxonomy(`taxonomy cc {
    terms {
      | surface { label = "Surface"; | api-service { label = "API"; } | web-portal {} }
      | data-store {}
    }
  }`);
  assert.deepEqual(t.terms.map((x) => x.id), ["surface", "data-store"]);
  const surface = t.terms[0];
  const dataStore = t.terms[1];
  assert.ok(surface);
  assert.ok(dataStore);
  assert.equal(surface.label, "Surface");
  assert.deepEqual(surface.children.map((c) => c.id), ["api-service", "web-portal"]);
  assert.deepEqual(dataStore.children, []);
});
