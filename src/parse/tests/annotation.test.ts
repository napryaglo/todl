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
  const d = decls(`namespace a { annotation Category { name : string; order : number?; } }`)[0] as AnnotationDecl;
  assert.equal(d.kind, DeclKind.Annotation);
  assert.equal(d.name, "Category");
  assert.equal(d.params.length, 2);
  assert.equal(d.params[0]!.name, "name");
  assert.equal(d.params[0]!.type, "string");
  assert.ok(d.nameSpan);
});

test("annotation with a base parses its extends (annotation Sub : Base)", () => {
  const d = decls(`namespace a { annotation Detailed : Visual { badge : string; } }`)[0] as AnnotationDecl;
  assert.equal(d.kind, DeclKind.Annotation);
  assert.equal(d.extends, "Visual");
  assert.ok(d.extendsSpan);
});

test("annotation without a base has null extends", () => {
  const d = decls(`namespace a { annotation Icon { path : string; } }`)[0] as AnnotationDecl;
  assert.equal(d.extends, null);
});

test("annotate inside a concept attaches an application to the concept", () => {
  const d = decls(`namespace a {
    concept Actor {
      annotate Icon { path = "icons/actor.svg"; }
      label : string;
    }
  }`)[0] as ConceptDecl;
  assert.equal(d.kind, DeclKind.Concept);
  assert.equal(d.annotations.length, 1);
  assert.equal(d.annotations[0]!.name, "Icon");
  assert.equal(d.annotations[0]!.assignments[0]!.name, "path");
  assert.ok(d.annotations[0]!.nameSpan);
});

test("package block parses to a PackageDecl of applications", () => {
  const d = decls(`namespace a {
    package {
      annotate Author { name = "Acme"; }
      annotate License { spdx = "MIT"; }
    }
  }`)[0] as PackageDecl;
  assert.equal(d.kind, DeclKind.Package);
  assert.equal(d.annotations.length, 2);
  assert.equal(d.annotations[1]!.name, "license");
});
