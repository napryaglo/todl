import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { prepareRename, renameEdits } from "../rename.js";

const SRC = [
  "namespace demo {",
  "  concept ani‸mal { }",     // definition (cursor here)
  "  concept dog : animal { }", // reference
  "  animal a { }",             // reference (instance concept)
  "}",
].join("\n");

test("prepareRename returns the identifier range at the cursor", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const range = prepareRename(analysis, uri, positions[0]!);
  assert.deepEqual(range, { start: { line: 1, character: 10 }, end: { line: 1, character: 16 } });
});

test("renameEdits rewrites the definition and every reference", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const edit = renameEdits(analysis, uri, positions[0]!, "creature");
  assert.ok(!("error" in edit));
  const edits = (edit as { changes: Record<string, unknown[]> }).changes["d.todl"]!;
  assert.equal(edits.length, 3);   // definition + 2 references
});

test("renameEdits rejects an invalid name", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const bad = renameEdits(analysis, uri, positions[0]!, "Animal");   // not kebab-case
  assert.ok("error" in bad);
});

test("renameEdits rejects a colliding name", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const clash = renameEdits(analysis, uri, positions[0]!, "dog");   // already defined
  assert.ok("error" in clash);
});
