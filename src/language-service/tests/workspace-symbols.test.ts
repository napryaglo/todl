import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../analysis.js";
import { workspaceSymbols } from "../workspace-symbols.js";

test("matches symbols by case-insensitive substring", () => {
  const a = analyze([{ uri: "d.todl", text: [
    "namespace demo {",
    "  concept person { }",
    "  concept product { }",
    "  person alice { }",
    "}",
  ].join("\n") }]);
  const names = workspaceSymbols(a, "per").map((s) => s.name).sort();
  assert.deepEqual(names, ["person"]);
  assert.deepEqual(workspaceSymbols(a, "p").map((s) => s.name).sort(), ["person", "product"]);
  // Location points into the file.
  assert.equal(workspaceSymbols(a, "person")[0]!.location.uri, "d.todl");
});

test("an empty query returns every symbol", () => {
  const a = analyze([{ uri: "d.todl", text: "namespace demo {\n  concept a { }\n}" }]);
  assert.equal(workspaceSymbols(a, "").length, 1);
});
