import { test } from "node:test";
import assert from "node:assert/strict";
import { compileForDisplay } from "../compile-for-display.js";

test("clean source compiles to ok=true with nodes and no error diagnostics", () => {
  const r = compileForDisplay([{ name: "m.todl", text:
    `namespace app { concept C { label : string; } model M : app { C c { label = "x"; } } }` }]);
  assert.equal(r.ok, true);
  assert.ok(r.document.nodes.length > 0);
  assert.equal(r.diagnostics.filter((d) => d.severity === "error").length, 0);
});

test("erroneous source reports ok=false with a diagnostic", () => {
  const r = compileForDisplay([{ name: "m.todl", text:
    `namespace app { concept C { label : string; } model M : app { C c { } } }` }]);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === "cardinality.required-missing"));
});

test("syntactically broken source does not throw", () => {
  const r = compileForDisplay([{ name: "m.todl", text: `namespace app { concept @@@ }` }]);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.length >= 1);
});
