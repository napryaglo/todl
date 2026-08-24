import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { MetaKind } from "../../model/kinds.js";
import { Severity } from "../../diagnostics/diagnostic.js";

// Regression: the prelude's diagram-nesting marker must NOT squat on the common
// domain word `container` (the C4 Container is a legitimate concept name). A
// meta-model that declares `concept container` and frames it in a viewpoint must
// resolve cleanly — no "provided by the default library", no "not a concept",
// no "annotation may only extend an annotation" cascade.
const SRC = `namespace mm {
  concept container {
    label          : string?;
    app_components : identifier[];
  }
  viewpoint V : frames container
}`;

test("a meta-model may declare `concept container` without colliding with the prelude", () => {
  const { model, diagnostics } = check([{ uri: "mm.todl", text: SRC }]);
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === Severity.Error),
    [],
    "no errors: `container` is the model's own concept, not a prelude marker",
  );
  const node = model.resolve("mm.container") ?? model.resolve("container");
  assert.ok(node, "`container` resolves");
  assert.equal(node.typeOf, MetaKind.Concept, "`container` resolves as a concept");
});
