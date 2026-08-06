import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (text: string) => check([{ uri: "a.todl", text }]).diagnostics.map((d) => d.code);

test("binding a meta-model that is a loaded namespace is clean", () => {
  const c = codes(`namespace acme {
    concept Component { }
    model Prod : Acme { Component checkout { } }
  }`);
  assert.ok(!c.includes(DiagnosticCode.ModelBindingUndefined));
});

test("binding a meta-model no module provides is model.binding-undefined", () => {
  const c = codes(`namespace acme {
    concept Component { }
    model Prod : Nonexistent { Component checkout { } }
  }`);
  assert.ok(c.includes(DiagnosticCode.ModelBindingUndefined));
});

test("a uses target that is not a known taxonomy is flagged", () => {
  // `uses` on a model names taxonomies (its term-drop scope). A `uses` of
  // something that is not a known taxonomy is a taxonomy-uses error.
  const c = codes(`namespace acme {
    concept Component { }
    model Prod : Acme uses GhostTax { Component checkout { } }
  }`);
  assert.ok(c.includes(DiagnosticCode.TaxonomyUsesUndefined));
});
