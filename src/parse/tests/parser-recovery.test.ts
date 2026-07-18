import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";

const SRC = `namespace demo {
  concept good-a { label : string; }
  concept @@@ { }
  concept good-b { label : string; }
}`;

test("parse recovers past a broken declaration and reports it", () => {
  const { namespace, diagnostics } = parse(SRC, "demo.todl");
  // Both well-formed concepts survived recovery.
  const names = namespace.declarations
    .filter((d) => d.kind === DeclKind.Concept)
    .map((d) => (d.kind === DeclKind.Concept ? d.name : ""));
  assert.deepEqual(names, ["good-a", "good-b"]);
  // The broken one produced at least one spanned syntax diagnostic.
  assert.ok(diagnostics.length >= 1);
  assert.equal(diagnostics[0]?.span?.uri, "demo.todl");
  assert.ok(diagnostics[0]?.code.startsWith("syntax."));
});
