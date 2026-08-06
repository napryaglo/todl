import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (text: string) =>
  load([{ uri: "a.todl", text }]).diagnostics.map((d) => d.code);

test("a top-level concrete object is an orphan", () => {
  const c = codes(`namespace acme {
    concept Component { }
    Component checkout { }
  }`);
  assert.ok(c.includes(DiagnosticCode.InstanceOrphan));
});

test("an object inside a model is not an orphan", () => {
  const c = codes(`namespace acme {
    concept Component { }
    model Prod : Acme { Component checkout { } }
  }`);
  assert.ok(!c.includes(DiagnosticCode.InstanceOrphan));
});

test("a top-level class is not an orphan", () => {
  const c = codes(`namespace acme {
    concept Component { }
    Class component base { }
  }`);
  assert.ok(!c.includes(DiagnosticCode.InstanceOrphan));
});
