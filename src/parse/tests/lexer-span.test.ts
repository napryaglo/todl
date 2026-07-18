import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenize, TokenKind } from "../lexer.js";
import { tokenSpan } from "../../diagnostics/span.js";

test("an identifier token records an end one past its last char", () => {
  const [id] = tokenize("alpha");
  assert.equal(id?.line, 1);
  assert.equal(id?.column, 1);
  assert.equal(id?.endLine, 1);
  assert.equal(id?.endColumn, 6); // 'alpha' is 5 chars, end is exclusive
});

test("a multi-line raw string records an end on a later line", () => {
  const tokens = tokenize('"""\nline two\n"""');
  const raw = tokens.find((t) => t.kind === TokenKind.RawString);
  assert.equal(raw?.line, 1);
  assert.equal(raw?.endLine, 3);
  assert.equal(raw?.endColumn, 4); // after the closing """
});

test("tokenSpan reads the token's start/end", () => {
  const [id] = tokenize("alpha");
  const span = tokenSpan(id!, "x.todl");
  assert.deepEqual(span, { uri: "x.todl", start: { line: 1, column: 1 }, end: { line: 1, column: 6 } });
});
