import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../parse/parser.js";
import { buildDefinitionIndex } from "../definitions.js";
import { SymbolKind } from "../symbols.js";

function defsOf(src: string, uri = "d.todl") {
  return buildDefinitionIndex(new Map([[uri, parse(src, uri).namespace]]));
}

test("an object declared inside a model is a definition target", () => {
  const defs = defsOf([
    "namespace app {",
    "  concept component { }",
    "  model prod : app {",
    "    component checkout { }",
    "  }",
    "}",
  ].join("\n"));
  assert.equal(defs.get("checkout")?.kind, SymbolKind.Instance);
  assert.equal(defs.get("prod")?.kind, SymbolKind.Instance);
});

test("a nested object inside a model object is a definition target", () => {
  const defs = defsOf([
    "namespace app {",
    "  concept component { }",
    "  model prod : app {",
    "    component outer { component inner { } }",
    "  }",
    "}",
  ].join("\n"));
  assert.ok(defs.get("inner"));
});
