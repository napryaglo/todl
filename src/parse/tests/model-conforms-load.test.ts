import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function loadResult(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]);
}

test("conforms is stamped on each contained entity as a flat attr", () => {
  const { model } = loadResult(`concept Component {}
    viewpoint ComponentView : frames Component
    model M : n conforms ComponentView { Component web {} }`);
  assert.equal(model.resolve("web")?.attrs.get("conforms"), "ComponentView");
});

test("a qualified conforms rewrites to the flat viewpoint id", () => {
  const { model, diagnostics } = loadResult(`concept Component {}
    viewpoint ComponentView : frames Component
    model M : n conforms n.ComponentView { Component web {} }`);
  assert.ok(!diagnostics.some((d) => d.code === DiagnosticCode.ModelConformsNotViewpoint));
  assert.equal(model.resolve("web")?.attrs.get("conforms"), "ComponentView");
});

test("conforms to a non-viewpoint is flagged", () => {
  const { diagnostics } = loadResult(`concept Component {}
    model M : n conforms Component { Component web {} }`);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ModelConformsNotViewpoint));
});

test("conforms to an unknown id is flagged", () => {
  const { diagnostics } = loadResult(`concept Component {}
    model M : n conforms Nope { Component web {} }`);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ModelConformsNotViewpoint));
});
