import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../../parse/loader.js";
import { Graph, Tier } from "../../model/graph.js";
import { MetaKind } from "../../model/kinds.js";
import { Repository } from "../../model/model.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(text: string): DiagnosticCode[] {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).model.validate().map((d) => d.code);
}

test("a taxonomy with no represented concept is flagged", () => {
  const g = new Graph();
  g.addNode({ id: "orphan", tier: Tier.Ontology, typeOf: MetaKind.Taxonomy, attrs: new Map() });
  const c = new Repository(g).validate().map((d) => d.code);
  assert.ok(c.includes(DiagnosticCode.TaxonomyNoRepresentedConcept));
});

test("a taxonomy-typed field value must resolve to a term", () => {
  // Use a value that is a defined node but not a term of the taxonomy — the
  // validator then reports TaxonomyValueUnresolved (an undefined symbol would
  // emit ReferenceUndefined from the loader instead, before validation runs).
  const c = codes(`concept Category { icon : string; }
    concept Component { category : ComponentCategory; }
    taxonomy ComponentCategory : represents Category { term ConversationalInterface { icon = "x"; } }
    Component good { category = ComponentCategory.ConversationalInterface; }
    Component bad { category = good; }`);
  assert.ok(c.includes(DiagnosticCode.TaxonomyValueUnresolved));
});

test("well-formed taxonomy usage yields no taxonomy diagnostics", () => {
  const c = codes(`concept Category { icon : string; }
    concept Component { category : ComponentCategory; }
    taxonomy ComponentCategory : represents Category { term ConversationalInterface { icon = "x"; } }
    Component good { category = ComponentCategory.ConversationalInterface; }`);
  assert.ok(!c.includes(DiagnosticCode.TaxonomyValueUnresolved));
  assert.ok(!c.includes(DiagnosticCode.TaxonomyNoRepresentedConcept));
});

test("a term whose concept is not represented is flagged", () => {
  // `microsoft` represents only location, but declares a technology term.
  const c = codes(`concept Location {} concept Technology {}
    taxonomy Microsoft : represents Location {
      Location azure          {}
      Technology azureOpenai {}
    }`);
  assert.ok(c.includes(DiagnosticCode.TermConceptNotRepresented));
});

test("a multi-representation taxonomy with matching term concepts is clean", () => {
  const c = codes(`concept Location {} concept Technology {}
    taxonomy Microsoft : represents Location, technology {
      Location azure          {}
      Technology azureOpenai {}
    }`);
  assert.ok(!c.includes(DiagnosticCode.TermConceptNotRepresented));
  assert.ok(!c.includes(DiagnosticCode.TaxonomyNoRepresentedConcept));
});
