import { test } from "node:test";
import assert from "node:assert/strict";
import { spanToRange, positionToTodl, rangeToSpan } from "../position.js";

test("spanToRange converts 1-based/exclusive TODL spans to 0-based LSP ranges", () => {
  const range = spanToRange({ uri: "d.todl", start: { line: 3, column: 16 }, end: { line: 3, column: 22 } });
  assert.deepEqual(range, { start: { line: 2, character: 15 }, end: { line: 2, character: 21 } });
});

test("positionToTodl is the inverse for a point", () => {
  assert.deepEqual(positionToTodl({ line: 2, character: 15 }), { line: 3, column: 16 });
});

test("rangeToSpan round-trips spanToRange", () => {
  const span = { uri: "d.todl", start: { line: 3, column: 16 }, end: { line: 3, column: 22 } };
  assert.deepEqual(rangeToSpan("d.todl", spanToRange(span)), span);
});
