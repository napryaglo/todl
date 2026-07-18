import { test } from "node:test";
import assert from "node:assert/strict";

import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostic.js";
import type { SourceSpan } from "../span.js";

test("a diagnostic carries a span and syntax codes exist", () => {
  const span: SourceSpan = { uri: "a.todl", start: { line: 1, column: 1 }, end: { line: 1, column: 4 } };
  const d: Diagnostic = {
    code: DiagnosticCode.UnexpectedToken,
    severity: Severity.Error,
    message: "boom",
    span,
    node: null,
    path: null,
  };
  assert.equal(d.span?.uri, "a.todl");
  assert.equal(DiagnosticCode.InvariantFailed, "invariant.failed"); // semantic codes preserved
});
