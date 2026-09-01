import { test } from "node:test";
import assert from "node:assert/strict";
import { compileStages } from "../compile-stages.js";

const SRC = { name: "m.todl", text:
  `namespace app { concept Component { label : string; } model M : app { Component c { label = "x"; } } }` };

test("tokens are extracted with kind/value/position", () => {
  const r = compileStages(SRC);
  assert.ok(r.tokens.length > 0);
  assert.ok(r.tokens.some((t) => t.value === "concept"));
  for (const t of r.tokens) { assert.equal(typeof t.line, "number"); assert.ok(t.kind.length > 0); }
});

test("astText reflects the namespace path and a concept name", () => {
  const r = compileStages(SRC);
  assert.ok(r.astText.includes("app"), "namespace path");
  assert.ok(r.astText.includes("Component"), "concept name");
  assert.ok(!/\bspan\b/i.test(r.astText), "span noise is stripped");
});

test("model rows line up with the emitted document nodes", () => {
  const r = compileStages(SRC);
  assert.equal(r.modelRows.length, r.document.nodes.length);
  assert.ok(r.modelRows.every((row) => row.label.length > 0));
});

test("a broken source yields a parse message in astText and does not throw", () => {
  const r = compileStages({ name: "m.todl", text: "namespace app { concept @@@ }" });
  assert.ok(r.astText.length > 0);
  assert.ok(r.tokens.length > 0); // tokenizing still works up to the bad char or reports it
});

test("deterministic across runs", () => {
  assert.deepEqual(compileStages(SRC), compileStages(SRC));
});
