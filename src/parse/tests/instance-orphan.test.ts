import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { DiagnosticCode } from "../../validate/validate.js";

function diags(text: string) {
  return loadFiles([{ uri: "s.todl", text }]).diagnostics;
}

test("a concrete object outside a model is an error", () => {
  const src = `namespace d { concept Component { label : string; } Component c { label = "C"; } }`;
  const ds = diags(src);
  assert.ok(ds.some((d) => d.code === DiagnosticCode.InstanceOrphan && d.severity === "error"));
});

test("the same object inside a model is clean", () => {
  const src = `namespace d { concept Component { label : string; } model M : D { Component c { label = "C"; } } }`;
  assert.ok(!diags(src).some((d) => d.code === DiagnosticCode.InstanceOrphan));
});
