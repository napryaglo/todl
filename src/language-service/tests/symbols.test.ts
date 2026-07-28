import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { SymbolKind, symbolKindOf } from "../symbols.js";

test("symbolKindOf distinguishes concepts, primitives, and instances", () => {
  const { model } = check([{ uri: "d.todl", text: [
    "namespace demo {",
    "  primitive string { }",
    "  concept person { name : string; }",
    "  person alice { }",
    "}",
  ].join("\n") }]);
  assert.equal(symbolKindOf(model, "person"), SymbolKind.Concept);
  assert.equal(symbolKindOf(model, "string"), SymbolKind.Primitive);
  assert.equal(symbolKindOf(model, "alice"), SymbolKind.Instance);
  assert.equal(symbolKindOf(model, "no-such-id"), SymbolKind.Unknown);
});
