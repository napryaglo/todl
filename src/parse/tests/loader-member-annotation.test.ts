import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";

const SRC = `namespace t {
  annotation heat { level : number; }
  concept technology {}
  concept component {
    relationship implementedBy -> technology { annotate heat { level = 3; } }
    relationship linkedTo -> component;
  }
}`;

test("a member annotation becomes a resolvable application node with its attrs", () => {
  const { model, diagnostics } = load([{ uri: "t.todl", text: SRC }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  const node = model.resolve("component.implementedBy@heat");
  assert.ok(node, "expected component.implementedBy@heat to exist");
  // Numeric annotation values store as strings (TODL has no Number value kind —
  // a numeric literal lexes as a Name and is set as a field verbatim).
  assert.equal(node?.attrs.get("level"), "3");
});

test("a bodyless member has no application node", () => {
  const { model } = load([{ uri: "t.todl", text: SRC }]);
  assert.equal(model.resolve("component.linkedTo@heat"), undefined);
});

test("an undeclared annotation on a member is diagnosed", () => {
  const bad = `namespace t {
    concept technology {}
    concept component { relationship implementedBy -> technology { annotate nope { x = 1; } } }
  }`;
  const { diagnostics } = load([{ uri: "t.todl", text: bad }]);
  assert.ok(
    diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined),
    "expected reference.undefined for the undeclared annotation",
  );
});
