import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, type ConceptDecl } from "../ast.js";

function concept(text: string): ConceptDecl {
  const decl = parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Concept);
  assert.ok(decl, "expected a concept declaration");
  return decl as ConceptDecl;
}

test("a relationship member body parses its annotate applications", () => {
  const c = concept(`namespace t {
    concept component {
      relationship implementedBy -> technology { annotate iconSource { order = 1; } }
    }
  }`);
  const rel = c.relationships[0];
  assert.equal(rel?.name, "implementedBy");
  assert.equal(rel?.annotations.length, 1);
  assert.equal(rel?.annotations[0]?.name, "iconSource");
  assert.equal(rel?.annotations[0]?.assignments[0]?.name, "order");
});

test("a bodyless relationship parses with an empty annotations array", () => {
  const c = concept(`namespace t {
    concept component { relationship linkedTo -> component; }
  }`);
  assert.deepEqual(c.relationships[0]?.annotations, []);
});

test("a non-annotate statement inside a relationship body is a parse error", () => {
  const { diagnostics } = parse(`namespace t {
    concept component { relationship implementedBy -> technology { order = 1; } }
  }`);
  assert.ok(
    diagnostics.some((d) => d.code.startsWith("syntax.")),
    "expected a syntax diagnostic for the non-annotate member-body statement",
  );
});
