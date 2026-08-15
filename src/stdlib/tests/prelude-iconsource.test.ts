import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { Severity } from "../../diagnostics/diagnostic.js";

const SRC = `namespace t {
  concept technology {}
  concept component {
    relationship implementedBy -> technology { annotate iconSource { order = 1; } }
  }
}`;

test("iconSource is a built-in annotation usable on a member with no local declaration", () => {
  const { model, diagnostics } = check([{ uri: "t.todl", text: SRC }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  const node = model.resolve("component.implementedBy@iconSource");
  assert.ok(node, "expected component.implementedBy@iconSource to exist");
  // Numeric values store as strings (TODL has no Number value kind).
  assert.equal(node?.attrs.get("order"), "1");
});

test("iconSource requires order (omitting it is an error)", () => {
  const bad = `namespace t {
    concept technology {}
    concept component { relationship implementedBy -> technology { annotate iconSource {} } }
  }`;
  const { diagnostics } = check([{ uri: "t.todl", text: bad }]);
  assert.ok(
    diagnostics.some((d) => d.severity === Severity.Error),
    "expected an error for the missing required order",
  );
});
