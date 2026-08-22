import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { Severity } from "../../diagnostics/diagnostic.js";

// The prelude ships `container` (marks a concept whose nodes render as a box
// that holds children) and `containment` (marks a relationship member whose
// refs project as visual nesting instead of a connector). Both are usable
// with no local declaration, mirroring `iconSource`/`wiki`.
const SRC = `namespace mm {
  concept location { annotate container {} }
  concept component {
    relationship in -> location { annotate containment {} }
  }
}`;

test("prelude ships container + containment annotations a meta-model can apply", () => {
  const { model, diagnostics } = check([{ uri: "mm.todl", text: SRC }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  assert.ok(model.resolve("location@container"), "container applied to a concept");
  assert.ok(
    model.resolve("component.in@containment"),
    "containment applied to a relationship member",
  );
});
