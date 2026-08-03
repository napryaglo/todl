import { test } from "node:test";
import assert from "node:assert/strict";

import { check, checkAgainst } from "../api.js";
import { DiagnosticCode } from "../diagnostics/diagnostic.js";

test("a standalone source resolves the prelude primitive `identifier` unqualified", () => {
  const { diagnostics } = check([{ uri: "a.todl", text: `namespace a { concept thing { key : identifier; } }` }]);
  assert.ok(
    !diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined),
    "identifier should resolve via the injected prelude",
  );
});

test("the prelude concept `element` is present in a plain check", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept thing { } }` }]);
  assert.ok(model.has("element"));
});

test("checkAgainst composes explicit bases with the prelude underneath", () => {
  const { diagnostics } = checkAgainst([], [{ uri: "a.todl", text: `namespace a { concept t { n : slug; } }` }]);
  assert.ok(!diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined));
});
