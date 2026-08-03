import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (text: string) => check([{ uri: "a.todl", text }]).diagnostics.map((d) => d.code);

test("a valid application produces no annotation diagnostics", () => {
  const c = codes(`namespace a {
    annotation badge { path : string; }
    concept actor { annotate badge { path = "a.svg"; } }
  }`);
  assert.ok(!c.includes(DiagnosticCode.AnnotationUnknownParam));
  assert.ok(!c.includes(DiagnosticCode.RequiredMissing));
});

test("an undeclared param is annotation.unknown-param", () => {
  const c = codes(`namespace a {
    annotation badge { path : string; }
    concept actor { annotate badge { path = "a.svg"; bogus = "x"; } }
  }`);
  assert.ok(c.includes(DiagnosticCode.AnnotationUnknownParam));
});

test("a missing required param is cardinality.required-missing", () => {
  const c = codes(`namespace a {
    annotation badge { path : string; }
    concept actor { annotate badge { } }
  }`);
  assert.ok(c.includes(DiagnosticCode.RequiredMissing));
});

test("an optional param may be omitted", () => {
  const c = codes(`namespace a {
    annotation category { name : string; order : number?; }
    concept actor { annotate category { name = "actors"; } }
  }`);
  assert.ok(!c.includes(DiagnosticCode.RequiredMissing));
  assert.ok(!c.includes(DiagnosticCode.AnnotationUnknownParam));
});
