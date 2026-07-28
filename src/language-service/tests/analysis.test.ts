import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../analysis.js";

test("analyze exposes per-file AST + tokens, the model, refs, and diagnostics", () => {
  const a = analyze([{ uri: "d.todl", text: [
    "namespace demo {",
    "  concept animal { }",
    "  concept dog : animal { }",
    "}",
  ].join("\n") }]);
  assert.ok(a.sources.get("d.todl")!.ast.declarations.length === 2);
  assert.ok(a.sources.get("d.todl")!.tokens.length > 0);
  assert.ok(a.model.has("dog"));
  assert.equal(a.refs.get("animal").length, 1);
  assert.equal(a.diagnostics.length, 0);
});

test("analyze surfaces validation diagnostics for a missing required field", () => {
  // An unresolved *reference* is stubbed to a placeholder by the loader (by
  // design), so it is not a diagnostic; a missing required scalar field is.
  const a = analyze([{ uri: "d.todl", text: [
    "namespace demo {",
    "  primitive string { }",
    "  concept person { name : string; }",
    "  person alice { }",
    "}",
  ].join("\n") }]);
  assert.ok(a.diagnostics.length >= 1);
});
