import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { visitReferences, RefRole } from "../references.js";

test("an operator's concept is visited as a reference", () => {
  const decl = parse(`namespace t { operator ~> : connector (from, to); }`).namespace.declarations[0];
  const names: string[] = [];
  visitReferences(decl, (v) => { if (v.role === RefRole.RecordConcept) names.push(v.name); });
  assert.deepEqual(names, ["connector"]);
});

test("a qualified operator concept rewrites flat", () => {
  const decl = parse(`namespace t { operator ~> : lib.connector (from, to); }`).namespace.declarations[0];
  visitReferences(decl, (v) => { if (v.role === RefRole.RecordConcept) v.rewrite("connector"); });
  assert.equal((decl as { concept: string }).concept, "connector");
});

test("an edge application's operands are visited as references", () => {
  const decl = parse(`namespace t { model M : t { agent ~> orchestrator; } }`).namespace.declarations[0];
  const names: string[] = [];
  visitReferences(decl, (v) => { if (v.role === RefRole.RefValue) names.push(v.name); });
  assert.ok(names.includes("agent") && names.includes("orchestrator"));
});
