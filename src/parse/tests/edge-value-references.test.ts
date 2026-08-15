import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { visitReferences, RefRole } from "../references.js";

test("an edge value's operands are visited as references", () => {
  const decl = parse(`namespace t { model M : t { sequence sq { steps = [ a ==> b ]; } } }`).namespace.declarations[0];
  const names: string[] = [];
  visitReferences(decl, (v) => { if (v.role === RefRole.RefValue) names.push(v.name); });
  assert.ok(names.includes("a") && names.includes("b"));
});

test("a qualified edge operand is offered a rewrite hook", () => {
  const decl = parse(`namespace t { model M : t { sequence sq { steps = [ lib.a ==> lib.b ]; } } }`).namespace.declarations[0];
  let rewired = false;
  visitReferences(decl, (v) => { if (v.role === RefRole.RefValue && v.name === "lib.a") { v.rewrite("a"); rewired = true; } });
  assert.ok(rewired, "the qualified operand was visited with a rewrite hook");
});
