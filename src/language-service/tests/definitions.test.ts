import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../parse/parser.js";
import { buildDefinitionIndex } from "../definitions.js";
import { SymbolKind } from "../symbols.js";

function defsOf(src: string, uri = "d.todl") {
  return buildDefinitionIndex(new Map([[uri, parse(src, uri).namespace]]));
}

test("indexes each definition's name range and kind", () => {
  const defs = defsOf([
    "namespace demo {",
    "  primitive string { }",
    "  concept person { }",
    "  person alice { }",
    "}",
  ].join("\n"));
  assert.equal(defs.get("person")?.kind, SymbolKind.Concept);
  assert.equal(defs.get("string")?.kind, SymbolKind.Primitive);
  assert.equal(defs.get("alice")?.kind, SymbolKind.Instance);
  // `person` name is on 0-based line 2, characters 10..16.
  assert.deepEqual(defs.get("person")?.nameRange, {
    start: { line: 2, character: 10 }, end: { line: 2, character: 16 },
  });
});

test("definitionAt resolves a position on a definition name", () => {
  const defs = defsOf("namespace demo {\n  concept person { }\n}");
  const hit = defs.definitionAt("d.todl", { line: 1, character: 12 });
  assert.equal(hit?.symbol, "person");
});
