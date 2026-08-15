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
  assert.deepEqual(kinds("relationship incoming -> sequenceFlow[];"), [
    TokenKind.Identifier,
    TokenKind.Identifier,
    TokenKind.SymbolOp,
    TokenKind.Identifier,
    TokenKind.LBracket,
    TokenKind.RBracket,
    TokenKind.Semicolon,
    TokenKind.EOF,
  ]);
});

test("edge glyphs lex as a single SymbolOp token", () => {
  const glyphs = tokenize("~> ==> --> -> <-> ->> !>").filter((t) => t.kind !== TokenKind.EOF);
  assert.deepEqual(glyphs.map((t) => t.kind), Array(7).fill(TokenKind.SymbolOp));
});

test("a SymbolOp preserves its exact glyph text", () => {
  const t = tokenize("a ==> b").find((t) => t.kind === TokenKind.SymbolOp);
  assert.equal(t?.value, "==>");
});

test("a lone = still lexes as assignment, not a SymbolOp", () => {
  const t = tokenize("x = y");
  assert.equal(t[1]?.kind, TokenKind.Equals);
});

test("a longer =-run lexes as a SymbolOp", () => {
  assert.equal(tokenize("x == y")[1]?.kind, TokenKind.SymbolOp);
});

test("tokenizes a reference value with the & sigil", () => {
  const tokens = tokenize("livesIn = &sales;");
  assert.deepEqual(tokens.map((token) => token.kind), [
    TokenKind.Identifier,
    TokenKind.Equals,
    TokenKind.Amp,
    TokenKind.Identifier,
    TokenKind.Semicolon,
    TokenKind.EOF,
  ]);
  assert.equal(tokens[0]?.value, "livesIn");
  assert.equal(tokens[3]?.value, "sales");
});

test("lexes C-like identifiers whole (upper + underscore); a hyphen no longer joins", () => {
  const whole = tokenize("AppComponent a_b9");
  assert.deepEqual(whole.map((t) => t.kind), [TokenKind.Identifier, TokenKind.Identifier, TokenKind.EOF]);
  assert.equal(whole[0]?.value, "AppComponent");
  assert.equal(whole[1]?.value, "a_b9");
  // a hyphen is no longer an identifier character: `a-b` splits into a / - / b,
  // where `-` is now an operator char (SymbolOp), not part of the identifier.
  const { tokens } = lex("a-b -> c", "x.todl");
  assert.equal(tokens[0]?.value, "a");
  assert.equal(tokens[1]?.kind, TokenKind.SymbolOp);
  assert.equal(tokens[1]?.value, "-");
  assert.equal(tokens[2]?.value, "b");
  assert.equal(tokens[3]?.kind, TokenKind.SymbolOp); // `->` tokenizes
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
    TokenKind.SymbolOp,
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
