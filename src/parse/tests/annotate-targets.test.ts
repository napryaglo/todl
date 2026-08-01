import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type TaxonomyDecl, type InstanceDecl } from "../ast.js";

function decls(text: string) {
  const { namespace, diagnostics } = parse(text, "t.todl");
  assert.deepEqual(diagnostics, [], "expected no parse diagnostics");
  return namespace.declarations;
}

test("annotate parses inside a taxonomy term body", () => {
  const tax = decls(`namespace t {
    taxonomy actors : represents actor {
      term internal {
        label = "Internal";
        annotate icon { path = "resources/ai_agent.svg"; }
      }
    }
  }`)[0] as TaxonomyDecl;
  const term = tax.terms[0]!;
  assert.equal(term.annotations.length, 1);
  assert.equal(term.annotations[0]!.name, "icon");
  assert.equal(term.annotations[0]!.assignments[0]!.name, "path");
});

test("a term keeps both an annotate and a nested sub-term", () => {
  const tax = decls(`namespace t {
    taxonomy actors : represents actor {
      term external {
        annotate icon { path = "x.svg"; }
        term partner { label = "Partner"; }
      }
    }
  }`)[0] as TaxonomyDecl;
  const term = tax.terms[0]!;
  assert.equal(term.annotations.length, 1);
  assert.equal(term.children.length, 1);
  assert.equal(term.children[0]!.id, "partner");
});

test("annotate parses inside a class body", () => {
  const cls = decls(`namespace t {
    class component web-app {
      annotate icon { path = "resources/web.svg"; }
    }
  }`)[0] as InstanceDecl;
  assert.equal(cls.kind, DeclKind.Instance);
  assert.equal(cls.isClass, true);
  assert.equal(cls.annotations.length, 1);
  assert.equal(cls.annotations[0]!.name, "icon");
});
