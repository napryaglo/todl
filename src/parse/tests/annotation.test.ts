import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type AnnotationDecl, type PackageDecl, type ConceptDecl } from "../ast.js";

function decls(text: string) {
  const { namespace, diagnostics } = parse(text, "t.todl");
  assert.deepEqual(diagnostics, [], "expected no parse diagnostics");
  return namespace.declarations;
}

test("annotation declaration parses to an AnnotationDecl with typed params", () => {
  const d = decls(`namespace a { annotation category { name : string; order : number?; } }`)[0] as AnnotationDecl;
  assert.equal(d.kind, DeclKind.Annotation);
  assert.equal(d.name, "category");
  assert.equal(d.params.length, 2);
  assert.equal(d.params[0]!.name, "name");
  assert.equal(d.params[0]!.type, "string");
  assert.ok(d.nameSpan);
});

test("annotate inside a concept attaches an application to the concept", () => {
  const d = decls(`namespace a {
    concept actor {
      annotate icon { path = "icons/actor.svg"; }
      label : string;
    }
  }`)[0] as ConceptDecl;
  assert.equal(d.kind, DeclKind.Concept);
  assert.equal(d.annotations.length, 1);
  assert.equal(d.annotations[0]!.name, "icon");
  assert.equal(d.annotations[0]!.assignments[0]!.name, "path");
  assert.ok(d.annotations[0]!.nameSpan);
});

test("package block parses to a PackageDecl of applications", () => {
  const d = decls(`namespace a {
    package {
      annotate author { name = "Acme"; }
      annotate license { spdx = "MIT"; }
    }
  }`)[0] as PackageDecl;
  assert.equal(d.kind, DeclKind.Package);
  assert.equal(d.annotations.length, 2);
  assert.equal(d.annotations[1]!.name, "license");
});
