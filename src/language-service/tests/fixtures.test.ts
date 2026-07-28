import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";

test("fixture strips markers and returns their 0-based positions", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept do‸g { }\n}");
  assert.equal(uri, "d.todl");
  assert.deepEqual(positions[0], { line: 1, character: 12 });
  // Text was cleaned, so it parses to one concept named "dog".
  assert.ok(analysis.model.has("dog"));
});
