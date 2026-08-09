import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type ModelDecl } from "../ast.js";

function model(src: string): ModelDecl {
  const { namespace } = parse(`namespace n {\n${src}\n}`, "t.todl");
  const decl = namespace.declarations.find((d) => d.kind === DeclKind.Model);
  assert.ok(decl, "expected a model declaration");
  return decl as ModelDecl;
}

test("model parses a conforms clause", () => {
  const m = model(`model M : mm conforms ComponentView {}`);
  assert.equal(m.conforms, "ComponentView");
});

test("conforms follows uses", () => {
  const m = model(`model M : mm uses tech conforms ComponentView {}`);
  assert.deepEqual(m.libraries, ["tech"]);
  assert.equal(m.conforms, "ComponentView");
});

test("a model without conforms has conforms null", () => {
  const m = model(`model M : mm {}`);
  assert.equal(m.conforms, null);
});

test("conforms accepts a qualified viewpoint", () => {
  const m = model(`model M : mm conforms archmm.ComponentView {}`);
  assert.equal(m.conforms, "archmm.ComponentView");
});
