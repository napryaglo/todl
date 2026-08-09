import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(text: string): DiagnosticCode[] {
  return check([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).diagnostics.map((d) => d.code);
}

const VP = `concept Component {} concept Node {}
  viewpoint ComponentView : frames Component`;

test("an entity of a framed concept is clean", () => {
  const c = codes(`${VP}
    model M : n conforms ComponentView { Component web {} }`);
  assert.ok(!c.includes(DiagnosticCode.ModelEntityNotFramed));
});

test("an entity of a non-framed concept is flagged", () => {
  const c = codes(`${VP}
    model M : n conforms ComponentView { Node host {} }`);
  assert.ok(c.includes(DiagnosticCode.ModelEntityNotFramed));
});

test("a subtype of a framed concept is clean (subtype-aware)", () => {
  const c = codes(`concept Component {} concept WebComponent : Component {}
    viewpoint ComponentView : frames Component
    model M : n conforms ComponentView { WebComponent web {} }`);
  assert.ok(!c.includes(DiagnosticCode.ModelEntityNotFramed));
});

test("a model without conforms imposes no framing constraint", () => {
  const c = codes(`${VP}
    model M : n { Node host {} }`);
  assert.ok(!c.includes(DiagnosticCode.ModelEntityNotFramed));
});
