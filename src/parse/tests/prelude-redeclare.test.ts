import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { DiagnosticCode, Severity } from "../../diagnostics/diagnostic.js";

test("redeclaring a prelude primitive warns but still compiles", () => {
  const { diagnostics } = check([{ uri: "a.todl", text: `namespace a { primitive identifier : string { } }` }]);
  const d = diagnostics.find((x) => x.code === DiagnosticCode.PreludeNameRedeclared);
  assert.ok(d, "expected a prelude.name-redeclared diagnostic");
  assert.equal(d!.severity, Severity.Warning);
});

test("redeclaring the root concept `element` warns", () => {
  const { diagnostics } = check([{ uri: "a.todl", text: `namespace a { concept Element { } }` }]);
  assert.ok(diagnostics.some((x) => x.code === DiagnosticCode.PreludeNameRedeclared));
});

test("a normal concept name does not warn", () => {
  const { diagnostics } = check([{ uri: "a.todl", text: `namespace a { concept Widget { } }` }]);
  assert.ok(!diagnostics.some((x) => x.code === DiagnosticCode.PreludeNameRedeclared));
});
