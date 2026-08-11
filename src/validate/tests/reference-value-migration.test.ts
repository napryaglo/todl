import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { DiagnosticCode } from "../validate.js";

// A required relationship member; the migration's exact before/after shapes.
const CONCEPTS = `
  concept actor {}
  concept edge { relationship end -> actor; }`;

function diagnostics(body: string) {
  return check([{ uri: "m.todl", text: `namespace ta {${CONCEPTS}\n${body}\n}` }]).diagnostics;
}

test("a quoted-string value on a required relationship is dropped -> required-missing", () => {
  const diags = diagnostics(`
    actor a {}
    edge e1 { end = "a"; }`);
  const missing = diags.filter((d) => d.code === DiagnosticCode.RequiredMissing && d.message.includes("edge.end"));
  assert.equal(missing.length, 1);
});

test("the bare form resolves clean", () => {
  const diags = diagnostics(`
    actor a {}
    edge e1 { end = a; }`);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.RequiredMissing), []);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.ReferenceUndefined), []);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.TargetTypeMismatch), []);
});
