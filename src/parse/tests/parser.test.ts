import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "../parser.js";
import { DeclKind, ValueKind } from "../ast.js";
import { Cardinality } from "../../model/graph.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

test("parses a primitive declaration with base and regex", () => {
  const namespace = parse(fixture("primitives.todl"));
  assert.equal(namespace.path, "adl.meta-models.bpmn.primitives");

  const primitive = namespace.declarations[0];
  assert.equal(primitive?.kind, DeclKind.Primitive);
  if (primitive?.kind === DeclKind.Primitive) {
    assert.equal(primitive.name, "identifier");
    assert.equal(primitive.base, "string");
    assert.match(primitive.regex ?? "", /\^\[a-z\]/);
  }
});

test("parses enum declarations with their cases", () => {
  const namespace = parse(fixture("enums.todl"));
  const taskType = namespace.declarations.find(
    (declaration) => declaration.kind === DeclKind.Enum && declaration.name === "task-type",
  );
  assert.ok(taskType && taskType.kind === DeclKind.Enum);
  if (taskType.kind === DeclKind.Enum) {
    assert.equal(taskType.cases.length, 7);
    assert.equal(taskType.cases[1]?.id, "user");
    assert.equal(taskType.cases[1]?.label, "User Task");
  }
});

test("parses concept imports, fields with cardinality, relationships, and invariants", () => {
  const namespace = parse(fixture("concepts.todl"));
  assert.deepEqual(namespace.imports, [
    "adl.meta-models.bpmn.primitives.identifier",
    "adl.meta-models.bpmn.enums.task-type",
  ]);

  const task = namespace.declarations.find(
    (declaration) => declaration.kind === DeclKind.Concept && declaration.name === "task",
  );
  assert.ok(task && task.kind === DeclKind.Concept);
  if (task.kind === DeclKind.Concept) {
    assert.equal(task.fields.find((field) => field.name === "label")?.cardinality, Cardinality.One);
    assert.equal(task.fields.find((field) => field.name === "assignee")?.cardinality, Cardinality.Optional);
    assert.equal(task.relationships.find((r) => r.name === "lives-in")?.cardinality, Cardinality.One);
    assert.equal(task.relationships.find((r) => r.name === "incoming")?.cardinality, Cardinality.Many);

    assert.equal(task.invariants.length, 2);
    assert.equal(task.invariants[0]?.predicate, null); // prose-only
    assert.ok((task.invariants[1]?.predicate?.length ?? 0) > 0); // has predicate tokens
  }
});

test("reports a malformed declaration with position", () => {
  assert.throws(() => parse("namespace x { concept }"), /expected .* at 1:23/i);
});

test("parses nested container instances with a meta-model binding", () => {
  const ns = parse(`namespace d {
    model m : enterprise-architecture {
      title = "T";
      location saas-3p { label = "3rd-Party SaaS"; type = logical-grouping; }
    }
  }`);
  const model = ns.declarations[0];
  assert.ok(model && model.kind === DeclKind.Instance);
  if (model.kind === DeclKind.Instance) {
    assert.equal(model.concept, "model");
    assert.equal(model.binds, "enterprise-architecture");
    assert.equal(model.assignments[0]?.name, "title");
    assert.equal(model.children.length, 1);
    assert.equal(model.children[0]?.concept, "location");
    assert.equal(model.children[0]?.id, "saas-3p");
  }
});

test("parses a string-keyed record id", () => {
  const ns = parse(`namespace d { sequence "Conversation via M365 Copilot" { } }`);
  const inst = ns.declarations[0];
  assert.ok(inst && inst.kind === DeclKind.Instance);
  if (inst.kind === DeclKind.Instance) {
    assert.equal(inst.concept, "sequence");
    assert.equal(inst.id, "Conversation via M365 Copilot");
  }
});

test("parses a |-composed enum-flag value", () => {
  const ns = parse(`namespace d { location on-prem { type = physical | on-premises | logical-grouping; } }`);
  const inst = ns.declarations[0];
  assert.ok(inst && inst.kind === DeclKind.Instance);
  if (inst.kind === DeclKind.Instance) {
    const value = inst.assignments[0]?.value;
    assert.equal(value?.kind, ValueKind.Composite);
    if (value?.kind === ValueKind.Composite) {
      assert.deepEqual(value.parts, ["physical", "on-premises", "logical-grouping"]);
    }
  }
});
