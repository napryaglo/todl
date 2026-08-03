import { test } from "node:test";
import assert from "node:assert/strict";

import { preludeDocument, preludeNames } from "../prelude.js";

test("prelude compiles with no diagnostics and carries the standard nodes", () => {
  const doc = preludeDocument();
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const id of ["identifier", "slug", "label", "icon", "toolbox", "instance", "element"]) {
    assert.ok(ids.has(id), `prelude is missing "${id}"`);
  }
});

test("preludeNames lists exactly the prelude-defined bare ids", () => {
  const names = preludeNames();
  for (const id of ["identifier", "slug", "label", "icon", "toolbox", "instance", "element"]) {
    assert.ok(names.has(id), `preludeNames missing "${id}"`);
  }
});
