import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (text: string) => check([{ uri: "t.todl", text }]).diagnostics.map((d) => d.code);

test("`uses` naming an unknown taxonomy is taxonomy.uses-undefined", () => {
  assert.ok(codes(
    `namespace n { concept C { label : string; } taxonomy T : represents C uses Ghost { C a { label = "A"; } } }`,
  ).includes(DiagnosticCode.TaxonomyUsesUndefined));
});

test("`uses` naming a non-taxonomy (a concept) is taxonomy.uses-undefined", () => {
  assert.ok(codes(
    `namespace n { concept C { label : string; } concept Other { label : string; } taxonomy T : represents C uses Other { C a { label = "A"; } } }`,
  ).includes(DiagnosticCode.TaxonomyUsesUndefined));
});

test("`uses` naming a real taxonomy is clean", () => {
  assert.ok(!codes(
    `namespace n { concept C { label : string; } taxonomy Real : represents C { term K { label = "K"; } } taxonomy T : represents C uses Real { C a { label = "A"; } } }`,
  ).includes(DiagnosticCode.TaxonomyUsesUndefined));
});
