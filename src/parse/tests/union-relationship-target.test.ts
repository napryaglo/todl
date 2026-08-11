import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, type ConceptDecl } from "../ast.js";

function rel(src: string) {
  const { namespace } = parse(`namespace t { concept x { relationship ${src} } }`);
  const concept = namespace.declarations.find(
    (d): d is ConceptDecl => d.kind === DeclKind.Concept,
  )!;
  return concept.relationships[0]!;
}

test("a single target parses as a length-1 targets array", () => {
  const r = rel("in -> location?;");
  assert.deepEqual(r.targets, ["location"]);
  assert.equal(r.targetSpans?.length, 1);
});

test("a pipe-union parses into an ordered targets array", () => {
  const r = rel("from -> actor | block | component[];");
  assert.deepEqual(r.targets, ["actor", "block", "component"]);
  assert.equal(r.targetSpans?.length, 3);
});
