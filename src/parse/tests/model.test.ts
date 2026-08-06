import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type ModelDecl } from "../ast.js";

function firstDecl(text: string) {
  const { namespace, diagnostics } = parse(text, "test.todl");
  assert.deepEqual(diagnostics, [], "expected no parse diagnostics");
  return namespace.declarations[0];
}

test("model parses to a ModelDecl with meta-model, uses, and object body", () => {
  const decl = firstDecl(`namespace acme {
    model prod : EnterpriseArchitecture uses AwsCatalog, EaPatterns {
      Component checkout { name = "Checkout"; }
      Component payments instanceof paymentService { name = "Payments"; }
    }
  }`) as ModelDecl;
  assert.equal(decl.kind, DeclKind.Model);
  assert.equal(decl.id, "prod");
  assert.equal(decl.metaModel, "EnterpriseArchitecture");
  assert.deepEqual(decl.libraries, ["AwsCatalog", "EaPatterns"]);
  assert.equal(decl.instances.length, 2);
  assert.equal(decl.instances[0]!.concept, "Component");
  assert.equal(decl.instances[1]!.instanceOf, "paymentService");
  assert.ok(decl.idSpan && decl.metaModelSpan && decl.librarySpans?.length === 2);
});

test("model with no uses list parses with empty libraries", () => {
  const decl = firstDecl(`namespace acme {
    model prod : ea { Component c { } }
  }`) as ModelDecl;
  assert.equal(decl.kind, DeclKind.Model);
  assert.deepEqual(decl.libraries, []);
  assert.equal(decl.instances.length, 1);
});
