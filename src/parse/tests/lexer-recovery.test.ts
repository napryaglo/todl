import { test } from "node:test";
import assert from "node:assert/strict";

import { lex, TokenKind } from "../lexer.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

test("an unexpected character is a diagnostic, and lexing continues", () => {
  const { tokens, diagnostics } = lex("alpha $ beta", "x.todl");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, DiagnosticCode.UnexpectedCharacter);
  assert.equal(diagnostics[0]?.span?.start.column, 7);
  // Both identifiers still tokenized (recovery skipped only the '$').
  const idents = tokens.filter((t) => t.kind === TokenKind.Identifier).map((t) => t.value);
  assert.deepEqual(idents, ["alpha", "beta"]);
});

test("an unterminated string is a diagnostic, not a throw", () => {
  const { diagnostics } = lex('name = "oops\n', "x.todl");
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.UnterminatedString));
});
