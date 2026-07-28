import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyze, completionsAt, hoverAt, definitionAt, referencesAt, spanToRange,
  renameEdits, prepareRename, documentSymbols, foldingRanges, workspaceSymbols,
  semanticTokens, signatureHelpAt, codeActions, formatDocument,
} from "../index.js";

test("the public barrel exposes the advanced surface", () => {
  for (const fn of [renameEdits, prepareRename, documentSymbols, foldingRanges,
    workspaceSymbols, semanticTokens, signatureHelpAt, codeActions, formatDocument]) {
    assert.equal(typeof fn, "function");
  }
});

test("the public barrel exposes the foundation surface", () => {
  const a = analyze([{ uri: "d.todl", text: "namespace demo {\n  concept a { }\n}" }]);
  assert.equal(typeof analyze, "function");
  assert.equal(typeof completionsAt, "function");
  assert.equal(typeof hoverAt, "function");
  assert.equal(typeof definitionAt, "function");
  assert.equal(typeof referencesAt, "function");
  assert.equal(typeof spanToRange, "function");
  assert.ok(a.model.has("a"));
});
