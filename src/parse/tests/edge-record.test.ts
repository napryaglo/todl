import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, ValueKind, type NameValue, type ModelDecl } from "../ast.js";

test("a native connector edge record has from/to, no operator attr, and a lexer-valid id", () => {
  const { namespace } = parse(`namespace d { connector businessAgent --> agentOrchestrator; }`);
  const edge = namespace.declarations[0]!;
  assert.ok(edge.kind === DeclKind.Instance);
  if (edge.kind === DeclKind.Instance) {
    assert.equal((edge.assignments.find((a) => a.name === "from")?.value as NameValue).name, "businessAgent");
    assert.equal((edge.assignments.find((a) => a.name === "to")?.value as NameValue).name, "agentOrchestrator");
    assert.equal(edge.assignments.find((a) => a.name === "operator"), undefined);
    assert.match(edge.id, /^connector_\d+$/);
  }
});

test("a native step edge record binds src/dst with no operator attr", () => {
  const { namespace } = parse(`namespace d { step a -> b; }`);
  const edge = namespace.declarations[0]!;
  assert.ok(edge.kind === DeclKind.Instance);
  if (edge.kind === DeclKind.Instance) {
    assert.equal((edge.assignments.find((a) => a.name === "src")?.value as NameValue).name, "a");
    assert.equal((edge.assignments.find((a) => a.name === "dst")?.value as NameValue).name, "b");
    assert.equal(edge.assignments.find((a) => a.name === "operator"), undefined);
    assert.match(edge.id, /^step_\d+$/);
  }
});

test("the synthetic id re-parses as an instance header; the old #-form does not", () => {
  const { namespace } = parse(`namespace d { connector a --> b; }`);
  const edge = namespace.declarations[0]!;
  assert.ok(edge.kind === DeclKind.Instance);
  const id = edge.kind === DeclKind.Instance ? edge.id : "";
  assert.deepEqual(parse(`namespace d { connector ${id} {} }`).diagnostics, []);
  assert.notEqual(parse(`namespace d { connector connector#1 {} }`).diagnostics.length, 0);
});

test("an application-connectors block gets a lexer-valid container id", () => {
  const { namespace } = parse(`namespace d { model m : ea { connectors { a --> b } } }`);
  const decl = namespace.declarations[0]!;
  assert.ok(decl.kind === DeclKind.Model);
  if (decl.kind === DeclKind.Model) {
    const block = (decl as ModelDecl).instances.find((i) => i.concept === "connectors")!;
    assert.match(block.id, /^application_connectors_\d+$/);
    // `connectors` is a keyword (block syntax); prove the id lexes clean as an
    // identifier by re-parsing it under an ordinary concept header.
    assert.deepEqual(parse(`namespace d { thing ${block.id} {} }`).diagnostics, []);
  }
});
