import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (text: string) => check([{ uri: "t.todl", text }]).diagnostics.map((d) => d.code);

test("`uses` naming an unknown taxonomy is taxonomy.uses-undefined", () => {
  assert.ok(codes(
    `namespace n { concept c { label : string; } taxonomy t : represents c uses ghost { c a { label = "A"; } } }`,
  ).includes(DiagnosticCode.TaxonomyUsesUndefined));
});

test("`uses` naming a non-taxonomy (a concept) is taxonomy.uses-undefined", () => {
  assert.ok(codes(
    `namespace n { concept c { label : string; } concept other { label : string; } taxonomy t : represents c uses other { c a { label = "A"; } } }`,
  ).includes(DiagnosticCode.TaxonomyUsesUndefined));
});

test("`uses` naming a real taxonomy is clean", () => {
  assert.ok(!codes(
    `namespace n { concept c { label : string; } taxonomy real : represents c { term k { label = "K"; } } taxonomy t : represents c uses real { c a { label = "A"; } } }`,
  ).includes(DiagnosticCode.TaxonomyUsesUndefined));
});
