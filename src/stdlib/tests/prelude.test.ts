import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { preludeDocument, preludeNames } from "../prelude.js";
import { PRELUDE_SOURCE } from "../prelude.generated.js";

test("prelude.generated.ts is in sync with prelude.todl (run `npm run gen:prelude`)", () => {
  const todl = readFileSync(new URL("../prelude.todl", import.meta.url), "utf8");
  assert.equal(PRELUDE_SOURCE, todl, "prelude.generated.ts is stale — regenerate it");
});

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
