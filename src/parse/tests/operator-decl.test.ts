import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, type OperatorDecl } from "../ast.js";

function firstOperator(text: string): OperatorDecl {
  return parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Operator) as OperatorDecl;
}

test("a reified-edge operator parses with concept + two endpoint members", () => {
  const op = firstOperator(`namespace t { operator ~> : connector (from, to); }`);
  assert.equal(op.glyph, "~>");
  assert.equal(op.concept, "connector");
  assert.equal(op.fromMember, "from");
  assert.equal(op.toMember, "to");
  assert.equal(op.relationship, null);
});

test("a relationship-form operator parses with concept.relationship", () => {
  const op = firstOperator(`namespace t { operator ->> : component.depends_on; }`);
  assert.equal(op.glyph, "->>");
  assert.equal(op.concept, "component");
  assert.equal(op.relationship, "depends_on");
  assert.equal(op.fromMember, null);
  assert.equal(op.toMember, null);
});
