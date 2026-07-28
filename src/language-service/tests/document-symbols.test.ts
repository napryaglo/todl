import { test } from "node:test";
import assert from "node:assert/strict";
import { SymbolKind } from "vscode-languageserver-types";
import { fixture } from "./fixtures.js";
import { documentSymbols } from "../document-symbols.js";

test("outlines concepts with their fields and relationships as children", () => {
  const { analysis, uri } = fixture("d.todl", [
    "namespace demo {",
    "  concept dog { name : string; relationship owner -> person []; }",
    "  dog rex { }",
    "}",
  ].join("\n"));
  const syms = documentSymbols(analysis, uri);
  const names = syms.map((s) => s.name).sort();
  assert.deepEqual(names, ["dog", "rex"]);
  const dog = syms.find((s) => s.name === "dog")!;
  assert.equal(dog.kind, SymbolKind.Class);
  assert.deepEqual(dog.children?.map((c) => c.name).sort(), ["name", "owner"]);
});
