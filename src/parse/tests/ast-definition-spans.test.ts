import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type ConceptDecl, type PrimitiveDecl, type InstanceDecl } from "../ast.js";

test("concept, primitive names and instance ids carry name spans", () => {
  const src = [
    "namespace demo {",
    "  primitive string { }",
    "  concept person { }",
    "  person alice { }",
    "}",
  ].join("\n");
  const { namespace } = parse(src, "d.todl");
  const prim = namespace.declarations.find(
    (d): d is PrimitiveDecl => d.kind === DeclKind.Primitive)!;
  const concept = namespace.declarations.find(
    (d): d is ConceptDecl => d.kind === DeclKind.Concept)!;
  const inst = namespace.declarations.find(
    (d): d is InstanceDecl => d.kind === DeclKind.Instance)!;
  // `string` starts at line 2 (1-based), column 13.
  assert.deepEqual(prim.nameSpan?.start, { line: 2, column: 13 });
  // `person` starts at line 3, column 11.
  assert.deepEqual(concept.nameSpan?.start, { line: 3, column: 11 });
  // `alice` (the id) starts at line 4, column 10.
  assert.deepEqual(inst.idSpan?.start, { line: 4, column: 10 });
});
