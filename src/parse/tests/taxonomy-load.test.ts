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
  const m = repo(`concept Hue {} taxonomy Color : represents Hue { term Red { label = "Red"; } term Blue {} }`);
  assert.equal(m.resolve("color")?.typeOf, MetaKind.Taxonomy);
  assert.deepEqual(m.related("color", EdgeKind.Represents, Direction.Out), ["hue"]);
  const red = m.resolve("Color.red");
  assert.equal(red?.tier, Tier.Instance);
  assert.equal(red?.typeOf, "hue");
  assert.equal(red?.attrs.get("class"), true);
  assert.equal(red?.attrs.get("label"), "Red");
  assert.deepEqual(m.narrowerOf("Color.red"), []);
});

test("a multi-representation taxonomy types each term by its own concept", () => {
  const { model: m, diagnostics } = loadResult(
    `concept Location {} concept Technology {}
     taxonomy Microsoft : represents Location, technology {
       Location azure          { label = "Azure"; }
       Technology azureOpenai { label = "Azure OpenAI"; }
     }`,
  );
  assert.equal(diagnostics.length, 0);
  // Both concepts are represented.
  assert.deepEqual(m.related("microsoft", EdgeKind.Represents, Direction.Out).sort(), ["location", "technology"]);
  assert.deepEqual(m.represents("microsoft").sort(), ["location", "technology"]);
  // Each term is a qualified, Instance-tier class of its own concept.
  const azure = m.resolve("Microsoft.Azure");
  assert.equal(azure?.typeOf, "location");
  assert.equal(azure?.attrs.get("class"), true);
  assert.equal(azure?.attrs.get("id"), "azure");
  assert.equal(m.resolve("Microsoft.azureOpenai")?.typeOf, "technology");
  // Both are Contains-members of the taxonomy.
  assert.deepEqual(m.termsOf("microsoft").sort(), ["Microsoft.Azure", "Microsoft.azureOpenai"]);
});

test("term relationship assignments (refs and lists) load as edges, scalars as attrs", () => {
  const m = repo(
    `concept Location { parent : Location?; } concept Technology { availableIn : Location[]; }
     taxonomy Microsoft : represents Location, technology {
       Location azure { label = "Azure"; }
       Location m365  { parent = Microsoft.Azure; }
       Technology graph { availableIn = [Microsoft.M365, Microsoft.Azure]; }
     }`,
  );
  assert.equal(m.resolve("Microsoft.Azure")?.attrs.get("label"), "Azure");
  assert.deepEqual(m.related("Microsoft.M365", EdgeKind.Relationship, Direction.Out, "parent"), ["Microsoft.Azure"]);
  assert.deepEqual(
    m.related("Microsoft.graph", EdgeKind.Relationship, Direction.Out, "availableIn").sort(),
    ["Microsoft.Azure", "Microsoft.M365"],
  );
});

test("a term composes a represented-concept record, bound to its field (not a term)", () => {
  const { model: m, diagnostics } = loadResult(
    `concept Billing { id : Identifier; perCall : string?; }
     concept Technology { billing : Billing?; }
     taxonomy Microsoft : represents Technology, billing {
       Technology azureOpenai { label = "AO"; Billing azureOpenaiBilling { perCall = "consumption"; } }
     }`,
  );
  assert.equal(diagnostics.filter((d) => d.code === DiagnosticCode.TermConceptNotRepresented).length, 0);
  assert.equal(m.resolve("Microsoft.azureOpenaiBilling")?.typeOf, "billing");
  assert.equal(m.resolve("Microsoft.azureOpenaiBilling")?.attrs.get("class"), true);
  assert.deepEqual(
    m.related("Microsoft.azureOpenai", EdgeKind.Relationship, Direction.Out, "billing"),
    ["Microsoft.azureOpenaiBilling"],
  );
  // The composition record is bound to the term, not a member of the taxonomy.
  assert.ok(!m.termsOf("microsoft").includes("Microsoft.azureOpenaiBilling"));
});

test("a term composing a non-represented concept is a load error", () => {
  const { diagnostics } = loadResult(
    `concept Billing { id : Identifier; } concept Technology { billing : Billing?; }
     taxonomy Microsoft : represents Technology {
       Technology azureOpenai { Billing azureOpenaiBilling {} }
     }`,
  );
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.TermConceptNotRepresented));
});

test("a bare `term` under a multi-concept taxonomy is flagged ambiguous", () => {
  const { diagnostics } = loadResult(
    `concept Location {} concept Technology {}
     taxonomy Microsoft : represents Location, technology { term Azure {} }`,
  );
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.TaxonomyTermConceptAmbiguous));
});

test("a nested taxonomy loads Narrower edges and answers branch queries", () => {
  const m = repo(`concept C {} taxonomy Cc : represents C { term Surface { term ApiService {} term WebPortal {} } term DataStore {} }`);
  assert.deepEqual(m.narrowerOf("cc.Surface").sort(), ["cc.ApiService", "cc.WebPortal"]);
  assert.deepEqual(m.broaderOf("cc.ApiService"), ["cc.Surface"]);
  assert.deepEqual(m.descendantsOf("cc.Surface").sort(), ["cc.ApiService", "cc.WebPortal"]);
});

test("a class and its instanceof leaf load with InstanceOf wiring", () => {
  const m = repo(`concept Component {} Class component teamsChat {} Component chat-hq instanceof teamsChat {}`);
  assert.equal(m.resolve("teamsChat")?.attrs.get("class"), true);
  assert.equal(m.resolve("chat-hq")?.attrs.get("class"), undefined);
  assert.deepEqual(m.related("chat-hq", EdgeKind.InstanceOf, Direction.Out), ["teamsChat"]);
});
