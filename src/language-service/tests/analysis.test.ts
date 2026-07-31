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

test("diagnosticsByUri groups diagnostics per file and lists every source", () => {
  const a = analyze([
    { uri: "a.todl", text: "namespace demo {\n  primitive string { }\n  concept person { name : string; }\n  person alice { }\n}" },
    { uri: "b.todl", text: "namespace other {\n  concept clean { }\n}" },
  ]);
  // Every source file has an entry (empty for the clean one).
  assert.ok(a.diagnosticsByUri.has("a.todl"));
  assert.ok(a.diagnosticsByUri.has("b.todl"));
  assert.equal(a.diagnosticsByUri.get("b.todl")!.length, 0);
  // The required-missing diagnostic is attributed to a.todl.
  assert.ok(a.diagnosticsByUri.get("a.todl")!.length >= 1);
});

test("analyze surfaces validation diagnostics for a missing required field", () => {
  // An unresolved *reference* is reported as reference.undefined by the loader,
  // which is distinct from a missing required scalar field (tested here).
  const a = analyze([{ uri: "d.todl", text: [
    "namespace demo {",
    "  primitive string { }",
    "  concept person { name : string; }",
    "  person alice { }",
    "}",
  ].join("\n") }]);
  assert.ok(a.diagnostics.length >= 1);
});
