import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";
import { mapDiagnostic } from "../diagnostics.js";

test("mapDiagnostic maps severity + span and preserves the code", () => {
  const lsp = mapDiagnostic({
    code: DiagnosticCode.UnexpectedToken, severity: Severity.Error, message: "boom",
    span: { uri: "d.todl", start: { line: 2, column: 3 }, end: { line: 2, column: 5 } },
    node: null, path: null,
  });
  assert.equal(lsp.severity, DiagnosticSeverity.Error);
  assert.equal(lsp.code, DiagnosticCode.UnexpectedToken);
  assert.deepEqual(lsp.range, { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } });
});

test("a null span collapses to the document start", () => {
  const lsp = mapDiagnostic({
    code: DiagnosticCode.InvariantFailed, severity: Severity.Warning, message: "x",
    span: null, node: null, path: null,
  });
  assert.equal(lsp.severity, DiagnosticSeverity.Warning);
  assert.deepEqual(lsp.range, { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } });
});
