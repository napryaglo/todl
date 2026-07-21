import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { MetaKind } from "../../model/kinds.js";
import { Tier, EdgeKind, Direction } from "../../model/graph.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function repo(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).model;
}

function loadResult(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]);
}

test("a flat taxonomy loads terms as Instance-tier classes of the represented concept", () => {
  const m = repo(`concept hue {} taxonomy color : represents hue { term red { label = "Red"; } term blue {} }`);
  assert.equal(m.resolve("color")?.typeOf, MetaKind.Taxonomy);
  assert.deepEqual(m.related("color", EdgeKind.Represents, Direction.Out), ["hue"]);
  const red = m.resolve("color.red");
  assert.equal(red?.tier, Tier.Instance);
  assert.equal(red?.typeOf, "hue");
  assert.equal(red?.attrs.get("class"), true);
  assert.equal(red?.attrs.get("label"), "Red");
  assert.deepEqual(m.narrowerOf("color.red"), []);
});

test("a multi-representation taxonomy types each term by its own concept", () => {
  const { model: m, diagnostics } = loadResult(
    `concept location {} concept technology {}
     taxonomy microsoft : represents location, technology {
       location azure          { label = "Azure"; }
       technology azure-openai { label = "Azure OpenAI"; }
     }`,
  );
  assert.equal(diagnostics.length, 0);
  // Both concepts are represented.
  assert.deepEqual(m.related("microsoft", EdgeKind.Represents, Direction.Out).sort(), ["location", "technology"]);
  assert.deepEqual(m.represents("microsoft").sort(), ["location", "technology"]);
  // Each term is a qualified, Instance-tier class of its own concept.
  const azure = m.resolve("microsoft.azure");
  assert.equal(azure?.typeOf, "location");
  assert.equal(azure?.attrs.get("class"), true);
  assert.equal(azure?.attrs.get("id"), "azure");
  assert.equal(m.resolve("microsoft.azure-openai")?.typeOf, "technology");
  // Both are Contains-members of the taxonomy.
  assert.deepEqual(m.termsOf("microsoft").sort(), ["microsoft.azure", "microsoft.azure-openai"]);
});

test("term relationship assignments (refs and lists) load as edges, scalars as attrs", () => {
  const m = repo(
    `concept location { parent : identifier?; } concept technology { available-in : identifier[]; }
     taxonomy microsoft : represents location, technology {
       location azure { label = "Azure"; }
       location m365  { parent = &microsoft.azure; }
       technology graph { available-in = [microsoft.m365, microsoft.azure]; }
     }`,
  );
  assert.equal(m.resolve("microsoft.azure")?.attrs.get("label"), "Azure");
  assert.deepEqual(m.related("microsoft.m365", EdgeKind.Relationship, Direction.Out, "parent"), ["microsoft.azure"]);
  assert.deepEqual(
    m.related("microsoft.graph", EdgeKind.Relationship, Direction.Out, "available-in").sort(),
    ["microsoft.azure", "microsoft.m365"],
  );
});

test("a term composes a represented-concept record, bound to its field (not a term)", () => {
  const { model: m, diagnostics } = loadResult(
    `concept billing { id : identifier; per-call : string?; }
     concept technology { billing : billing?; }
     taxonomy microsoft : represents technology, billing {
       technology azure-openai { label = "AO"; billing azure-openai-billing { per-call = "consumption"; } }
     }`,
  );
  assert.equal(diagnostics.filter((d) => d.code === DiagnosticCode.TermConceptNotRepresented).length, 0);
  assert.equal(m.resolve("microsoft.azure-openai-billing")?.typeOf, "billing");
  assert.equal(m.resolve("microsoft.azure-openai-billing")?.attrs.get("class"), true);
  assert.deepEqual(
    m.related("microsoft.azure-openai", EdgeKind.Relationship, Direction.Out, "billing"),
    ["microsoft.azure-openai-billing"],
  );
  // The composition record is bound to the term, not a member of the taxonomy.
  assert.ok(!m.termsOf("microsoft").includes("microsoft.azure-openai-billing"));
});

test("a term composing a non-represented concept is a load error", () => {
  const { diagnostics } = loadResult(
    `concept billing { id : identifier; } concept technology { billing : billing?; }
     taxonomy microsoft : represents technology {
       technology azure-openai { billing azure-openai-billing {} }
     }`,
  );
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.TermConceptNotRepresented));
});

test("a bare `term` under a multi-concept taxonomy is flagged ambiguous", () => {
  const { diagnostics } = loadResult(
    `concept location {} concept technology {}
     taxonomy microsoft : represents location, technology { term azure {} }`,
  );
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.TaxonomyTermConceptAmbiguous));
});

test("a nested taxonomy loads Narrower edges and answers branch queries", () => {
  const m = repo(`concept c {} taxonomy cc : represents c { term surface { term api-service {} term web-portal {} } term data-store {} }`);
  assert.deepEqual(m.narrowerOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
  assert.deepEqual(m.broaderOf("cc.api-service"), ["cc.surface"]);
  assert.deepEqual(m.descendantsOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
});

test("a class and its instanceof leaf load with InstanceOf wiring", () => {
  const m = repo(`concept component {} class component teams-chat {} component chat-hq instanceof teams-chat {}`);
  assert.equal(m.resolve("teams-chat")?.attrs.get("class"), true);
  assert.equal(m.resolve("chat-hq")?.attrs.get("class"), undefined);
  assert.deepEqual(m.related("chat-hq", EdgeKind.InstanceOf, Direction.Out), ["teams-chat"]);
});
