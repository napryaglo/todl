import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { DiagnosticCode } from "../validate.js";

// Mirrors the tech-architecture connector shape: a union relationship endpoint
// plus a concept-typed single-target field. Locks the SP1 capability the
// meta-model leans on, since the meta-model content is not in any test suite.
const CONCEPTS = `
  concept actor {} concept block {} concept location {}
  concept component {} concept application {} concept technology {}
  concept connector {
    relationship from -> actor | block | location | component | application;
    delivered : component?;
  }`;

function diagnostics(body: string) {
  return check([{ uri: "ta.todl", text: `namespace ta {${CONCEPTS}\n${body}\n}` }]).diagnostics;
}

test("a connector endpoint pointing at a union member and a typed field load clean", () => {
  const diags = diagnostics(`
    actor alice {}
    component web {}
    connector c1 { from = alice; delivered = web; }`);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.TargetTypeMismatch), []);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.ReferenceUndefined), []);
});

test("a connector endpoint outside the union is a TargetTypeMismatch naming the union", () => {
  const diags = diagnostics(`
    technology react {}
    connector c1 { from = react; }`);
  const mismatch = diags.filter((d) => d.code === DiagnosticCode.TargetTypeMismatch);
  assert.equal(mismatch.length, 1);
  assert.match(mismatch[0]!.message, /actor \| block \| location \| component \| application/);
});
