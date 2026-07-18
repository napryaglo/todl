import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenize, lex, TokenKind } from "../lexer.js";

function kinds(source: string): TokenKind[] {
  return tokenize(source).map((token) => token.kind);
}

test("tokenizes a field declaration with optional cardinality", () => {
  assert.deepEqual(kinds("label : string?;"), [
    TokenKind.Identifier,
    TokenKind.Colon,
    TokenKind.Identifier,
    TokenKind.Question,
    TokenKind.Semicolon,
    TokenKind.EOF,
  ]);
});

test("tokenizes a relationship with a list-cardinality target", () => {
  assert.deepEqual(kinds("relationship incoming -> sequence-flow[];"), [
    TokenKind.Identifier,
    TokenKind.Identifier,
    TokenKind.Arrow,
    TokenKind.Identifier,
    TokenKind.LBracket,
    TokenKind.RBracket,
    TokenKind.Semicolon,
    TokenKind.EOF,
  ]);
});

test("tokenizes a reference value with the & sigil", () => {
  const tokens = tokenize("lives-in = &sales;");
  assert.deepEqual(tokens.map((token) => token.kind), [
    TokenKind.Identifier,
    TokenKind.Equals,
    TokenKind.Amp,
    TokenKind.Identifier,
    TokenKind.Semicolon,
    TokenKind.EOF,
  ]);
  assert.equal(tokens[0]?.value, "lives-in");
  assert.equal(tokens[3]?.value, "sales");
});

test("keeps hyphenated identifiers whole and distinguishes the arrow", () => {
  const tokens = tokenize("sequence-flow -> lane");
  assert.deepEqual(tokens.map((token) => token.kind), [
    TokenKind.Identifier,
    TokenKind.Arrow,
    TokenKind.Identifier,
    TokenKind.EOF,
  ]);
  assert.equal(tokens[0]?.value, "sequence-flow");
});

test("tokenizes string literals", () => {
  const tokens = tokenize('label = "React";');
  assert.equal(tokens[2]?.kind, TokenKind.String);
  assert.equal(tokens[2]?.value, "React");
});

test("tokenizes a raw string with common indentation stripped", () => {
  const tokens = tokenize('x = """\n    line one\n    line two\n    """;');
  const raw = tokens.find((token) => token.kind === TokenKind.RawString);
  assert.equal(raw?.value, "line one\nline two");
});

test("tokenizes predicate operators", () => {
  assert.deepEqual(kinds("this.type == service || none implies x.empty"), [
    TokenKind.Identifier,
    TokenKind.Dot,
    TokenKind.Identifier,
    TokenKind.EqEq,
    TokenKind.Identifier,
    TokenKind.Or,
    TokenKind.Identifier,
    TokenKind.Identifier,
    TokenKind.Identifier,
    TokenKind.Dot,
    TokenKind.Identifier,
    TokenKind.EOF,
  ]);
});

test("skips line and block comments", () => {
  assert.deepEqual(kinds("// comment\n label /* block */ : string;"), [
    TokenKind.Identifier,
    TokenKind.Colon,
    TokenKind.Identifier,
    TokenKind.Semicolon,
    TokenKind.EOF,
  ]);
});

test("tracks line and column at token start", () => {
  const tokens = tokenize("a\n  b");
  assert.equal(tokens[0]?.line, 1);
  assert.equal(tokens[0]?.column, 1);
  assert.equal(tokens[1]?.line, 2);
  assert.equal(tokens[1]?.column, 3);
});

test("reports an unexpected character with position (recovers, no throw)", () => {
  const { diagnostics } = lex("a $ b", "x.todl");
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]?.message ?? "", /unexpected character/i);
  assert.equal(diagnostics[0]?.span?.start.line, 1);
  assert.equal(diagnostics[0]?.span?.start.column, 3);
});
