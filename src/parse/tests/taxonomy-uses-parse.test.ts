import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type TaxonomyDecl } from "../ast.js";

function taxonomy(text: string): TaxonomyDecl {
  const { namespace, diagnostics } = parse(text, "t.todl");
  assert.deepEqual(diagnostics, [], "no parse diagnostics");
  const d = namespace.declarations[0]!;
  assert.equal(d.kind, DeclKind.Taxonomy);
  return d as TaxonomyDecl;
}

test("a taxonomy `uses` list parses after `represents`", () => {
  const t = taxonomy(`namespace n { taxonomy Mtech : represents Location, technology uses Categories, roles { Location a { label = "A"; } } }`);
  assert.deepEqual(t.represents, ["location", "technology"]);
  assert.deepEqual(t.uses, ["categories", "roles"]);
  assert.equal(t.terms[0]!.id, "a");
});

test("a taxonomy with no `uses` has an empty list", () => {
  const t = taxonomy(`namespace n { taxonomy Roles : represents Actor { Actor u { label = "U"; } } }`);
  assert.deepEqual(t.uses, []);
});
