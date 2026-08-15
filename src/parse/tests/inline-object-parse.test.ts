import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, ValueKind, type ModelDecl, type ObjectValue } from "../ast.js";

function firstInstanceAssignments(text: string) {
  const model = parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Model) as ModelDecl;
  return model.instances[0].assignments;
}

test("a typed inline object parses as an Object value", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { component c1 {
    primary = slot { environment = prod; };
  } } }`);
  const v = a[0].value as ObjectValue;
  assert.equal(v.kind, ValueKind.Object);
  assert.equal(v.concept, "slot");
  assert.equal(v.assignments[0].name, "environment");
});

test("a list of inline objects parses, with an id assignment", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { component c1 {
    slots = [ slot { environment = prod; }, slot { id = o7f3a9c1; environment = dev; } ];
  } } }`);
  assert.equal(a[0].value.kind, ValueKind.List);
  const items = (a[0].value as { items: ObjectValue[] }).items;
  assert.equal(items[1].concept, "slot");
  assert.equal(items[1].assignments.find((x) => x.name === "id")?.value.kind, ValueKind.Name);
});

test("a bare name value still parses as a Name (no false object match)", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { component c1 {
    realised_by = microsoft_tech.m365_copilot;
  } } }`);
  assert.equal(a[0].value.kind, ValueKind.Name);
});
