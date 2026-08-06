import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type TaxonomyDecl, type InstanceDecl, type StringValue } from "../ast.js";

function decls(text: string) {
  const { namespace, diagnostics } = parse(text, "t.todl");
  assert.deepEqual(diagnostics, [], "expected no parse diagnostics");
  return namespace.declarations;
}

test("annotate parses at the taxonomy level (annotates the taxonomy itself)", () => {
  const tax = decls(`namespace t {
    taxonomy Actors : represents Actor {
      annotate Icon { path = "resources/actors.svg"; }
      term Internal { label = "Internal"; }
    }
  }`)[0] as TaxonomyDecl;
  assert.equal(tax.annotations.length, 1, "one taxonomy-level annotation");
  assert.equal(tax.annotations[0]!.name, "Icon");
  assert.equal(tax.annotations[0]!.assignments[0]!.name, "path");
  // The annotate is NOT mis-parsed as a concept-led term named "Icon".
  assert.deepEqual(tax.terms.map((t) => t.id), ["internal"]);
});

test("a taxonomy keeps both taxonomy-level and term-level annotations", () => {
  const tax = decls(`namespace t {
    taxonomy Actors : represents Actor {
      annotate Icon { path = "tax.svg"; }
      term Internal { annotate Icon { path = "term.svg"; } }
    }
  }`)[0] as TaxonomyDecl;
  assert.equal(tax.annotations.length, 1);
  assert.equal((tax.annotations[0]!.assignments[0]!.value as StringValue).text, "tax.svg");
  assert.equal(tax.terms[0]!.annotations.length, 1);
  assert.equal((tax.terms[0]!.annotations[0]!.assignments[0]!.value as StringValue).text, "term.svg");
});

test("annotate parses inside a taxonomy term body", () => {
  const tax = decls(`namespace t {
    taxonomy Actors : represents Actor {
      term Internal {
        label = "Internal";
        annotate Icon { path = "resources/ai_agent.svg"; }
      }
    }
  }`)[0] as TaxonomyDecl;
  const term = tax.terms[0]!;
  assert.equal(term.annotations.length, 1);
  assert.equal(term.annotations[0]!.name, "Icon");
  assert.equal(term.annotations[0]!.assignments[0]!.name, "path");
});

test("a term keeps both an annotate and a nested sub-term", () => {
  const tax = decls(`namespace t {
    taxonomy Actors : represents Actor {
      term External {
        annotate Icon { path = "x.svg"; }
        term Partner { label = "Partner"; }
      }
    }
  }`)[0] as TaxonomyDecl;
  const term = tax.terms[0]!;
  assert.equal(term.annotations.length, 1);
  assert.equal(term.children.length, 1);
  assert.equal(term.children[0]!.id, "Partner");
});

test("annotate parses inside a class body", () => {
  const cls = decls(`namespace t {
    class Component webApp {
      annotate Icon { path = "resources/web.svg"; }
    }
  }`)[0] as InstanceDecl;
  assert.equal(cls.kind, DeclKind.Instance);
  assert.equal(cls.isClass, true);
  assert.equal(cls.annotations.length, 1);
  assert.equal(cls.annotations[0]!.name, "Icon");
});
