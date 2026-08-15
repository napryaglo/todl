import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "../parser.js";
import { DeclKind, ValueKind, type InstanceDecl, type ModelDecl, type NameValue } from "../ast.js";
import { Cardinality } from "../../model/graph.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

test("parses a primitive declaration with base and regex", () => {
  const { namespace } = parse(fixture("primitives.todl"));
  assert.equal(namespace.path, "adl.metaModels.bpmn.primitives");

  const primitive = namespace.declarations[0];
  assert.equal(primitive?.kind, DeclKind.Primitive);
  if (primitive?.kind === DeclKind.Primitive) {
    assert.equal(primitive.name, "Identifier");
    assert.equal(primitive.base, "string");
    assert.match(primitive.regex ?? "", /\^\[a-z\]/);
  }
});

test("parses taxonomy declarations with their terms", () => {
  const { namespace } = parse(fixture("enums.todl"));
  const taskType = namespace.declarations.find(
    (declaration) => declaration.kind === DeclKind.Taxonomy && declaration.name === "TaskType",
  );
  assert.ok(taskType && taskType.kind === DeclKind.Taxonomy);
  if (taskType.kind === DeclKind.Taxonomy) {
    assert.deepEqual(taskType.represents, ["Task"]);
    assert.equal(taskType.terms.length, 7);
    assert.equal(taskType.terms[1]?.id, "User");
    const label = taskType.terms[1]?.assignments.find((a) => a.name === "label");
    assert.ok(label && label.value.kind === ValueKind.String);
    assert.equal(label.value.text, "User Task");
  }
});

test("parses concept imports, fields with cardinality, relationships, and invariants", () => {
  const { namespace } = parse(fixture("concepts.todl"));
  assert.deepEqual(namespace.imports, [
    "adl.metaModels.bpmn.primitives.Identifier",
    "adl.metaModels.bpmn.enums.TaskType",
  ]);

  const task = namespace.declarations.find(
    (declaration) => declaration.kind === DeclKind.Concept && declaration.name === "Task",
  );
  assert.ok(task && task.kind === DeclKind.Concept);
  if (task.kind === DeclKind.Concept) {
    assert.equal(task.fields.find((field) => field.name === "label")?.cardinality, Cardinality.One);
    assert.equal(task.fields.find((field) => field.name === "assignee")?.cardinality, Cardinality.Optional);
    assert.equal(task.relationships.find((r) => r.name === "livesIn")?.cardinality, Cardinality.One);
    assert.equal(task.relationships.find((r) => r.name === "incoming")?.cardinality, Cardinality.Many);

    assert.equal(task.invariants.length, 2);
    assert.equal(task.invariants[0]?.predicate, null); // prose-only
    assert.ok((task.invariants[1]?.predicate?.length ?? 0) > 0); // has predicate tokens
  }
});

test("reports a malformed declaration with position (recovers, no throw)", () => {
  const { diagnostics } = parse("namespace x { concept }", "x.todl");
  assert.ok(diagnostics.length >= 1);
  assert.match(diagnostics[0]?.message ?? "", /expected/i);
  assert.equal(diagnostics[0]?.span?.uri, "x.todl");
});

test("tolerates doc-only concept members (authoring blocks, references, formal invariants)", () => {
  const { namespace: ns } = parse(`namespace d {
    concept Component {
      description = "A thing.";
      label : string;
      invariant { description = "Ids unique."; formal = "for all c in C"; }
      authoring listForm { description = "Primary."; example = "components: …"; }
      references = [ "docs/a.md", "docs/b.md" ];
    }
  }`);
  const concept = ns.declarations[0];
  assert.ok(concept && concept.kind === DeclKind.Concept);
  if (concept.kind === DeclKind.Concept) {
    assert.equal(concept.fields.length, 1);
    assert.equal(concept.fields[0]?.name, "label");
    assert.equal(concept.invariants.length, 1);
    assert.equal(concept.invariants[0]?.predicate, null); // formal downgraded to prose
  }
});

test("rejects an `object`-typed field — object is not a TODL type", () => {
  const { diagnostics } = parse(`namespace d {
    concept Component {
      slots : Object { id : Identifier; }[];
    }
  }`);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.UnexpectedToken));
});

test("rejects a `{ … }` object value literal — no anonymous records", () => {
  const { diagnostics } = parse(`namespace d {
    Technology t { billing = { hosting = azureConsumption; }; }
  }`);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.UnexpectedToken));
});

test("parses edge applications inside a model body", () => {
  const { namespace: ns } = parse(`namespace d {
    model m : ea {
      externalAgentBridge --> agentService;
    }
  }`);
  const model = ns.declarations[0] as ModelDecl;
  assert.equal(model.edges.length, 1);
  assert.equal(model.edges[0]?.left, "externalAgentBridge");
  assert.equal(model.edges[0]?.glyph, "-->");
  assert.equal(model.edges[0]?.right, "agentService");
});

test("parses a model with a meta-model binding and nested instances", () => {
  const { namespace: ns } = parse(`namespace d {
    model m : EnterpriseArchitecture {
      Location saas3p { label = "3rd-Party SaaS"; type = logicalGrouping; }
    }
  }`);
  const model = ns.declarations[0];
  assert.ok(model && model.kind === DeclKind.Model);
  if (model.kind === DeclKind.Model) {
    assert.equal(model.id, "m");
    assert.equal(model.metaModel, "EnterpriseArchitecture");
    assert.equal(model.instances.length, 1);
    assert.equal(model.instances[0]?.concept, "Location");
    assert.equal(model.instances[0]?.id, "saas3p");
  }
});

test("parses a string-keyed record id", () => {
  const { namespace: ns } = parse(`namespace d { sequence "Conversation via M365 Copilot" { } }`);
  const inst = ns.declarations[0];
  assert.ok(inst && inst.kind === DeclKind.Instance);
  if (inst.kind === DeclKind.Instance) {
    assert.equal(inst.concept, "sequence");
    assert.equal(inst.id, "Conversation via M365 Copilot");
  }
});

test("parses a class modifier and an instanceof leaf", () => {
  const { namespace: ns } = parse(`namespace d {
    class Component teamsChat { realisedBy = microsoftTeams; }
    Component chatHq instanceof teamsChat { in = hq; }
  }`);
  const cls = ns.declarations[0];
  assert.ok(cls && cls.kind === DeclKind.Instance);
  if (cls.kind === DeclKind.Instance) {
    assert.equal(cls.concept, "Component");
    assert.equal(cls.id, "teamsChat");
    assert.equal(cls.isClass, true);
    assert.equal(cls.instanceOf, null);
  }
  const leaf = ns.declarations[1];
  assert.ok(leaf && leaf.kind === DeclKind.Instance);
  if (leaf.kind === DeclKind.Instance) {
    assert.equal(leaf.id, "chatHq");
    assert.equal(leaf.isClass, false);
    assert.equal(leaf.instanceOf, "teamsChat");
  }
});

test("parses a |-composed enum-flag value", () => {
  const { namespace: ns } = parse(`namespace d { Location onPrem { type = physical | onPremises | logicalGrouping; } }`);
  const inst = ns.declarations[0];
  assert.ok(inst && inst.kind === DeclKind.Instance);
  if (inst.kind === DeclKind.Instance) {
    const value = inst.assignments[0]?.value;
    assert.equal(value?.kind, ValueKind.Composite);
    if (value?.kind === ValueKind.Composite) {
      assert.deepEqual(value.parts, ["physical", "onPremises", "logicalGrouping"]);
    }
  }
});
