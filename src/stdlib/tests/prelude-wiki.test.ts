import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { Severity } from "../../diagnostics/diagnostic.js";

// A concept carrying a wiki annotation resolves `<concept>@wiki`.path.
const SRC = `namespace demo {
  concept service { annotate wiki { path = "wiki/service.md"; } }
}`;

test("wiki annotation is declared in the prelude and resolves path", () => {
  const { model, diagnostics } = check([{ uri: "m.todl", text: SRC }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  const node = model.resolve("service@wiki");
  assert.ok(node, "expected service@wiki to exist");
  assert.equal(node?.attrs.get("path"), "wiki/service.md");
});
