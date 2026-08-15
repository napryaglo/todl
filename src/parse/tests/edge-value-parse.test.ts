import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, ValueKind, type ModelDecl, type EdgeValue } from "../ast.js";

function firstInstanceAssignments(text: string) {
  const m = parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Model) as ModelDecl;
  return m.instances[0].assignments;
}

test("an edge on the RHS of = parses as an Edge value", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { sequence sq { primary = x ==> y; } } }`);
  const v = a.find((x) => x.name === "primary")!.value as EdgeValue;
  assert.equal(v.kind, ValueKind.Edge);
  assert.equal(v.edge.glyph, "==>");
  assert.equal(v.edge.left, "x");
  assert.equal(v.edge.right, "y");
});

test("a list of edges parses as a list of Edge values", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { sequence sq { steps = [ a ==> b, b ==> c ]; } } }`);
  const list = a.find((x) => x.name === "steps")!.value;
  assert.equal(list.kind, ValueKind.List);
  const items = (list as { items: EdgeValue[] }).items;
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, ValueKind.Edge);
  assert.equal(items[1].edge.left, "b");
});

test("an edge value with a body captures body assignments", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { sequence sq { primary = x ==> y { kind = fast; }; } } }`);
  const v = a.find((x) => x.name === "primary")!.value as EdgeValue;
  assert.ok(v.edge.body.find((b) => b.name === "kind"));
});

test("a bare name value is still a Name (not an edge)", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { sequence sq { entry_point = actor1; } } }`);
  assert.equal(a.find((x) => x.name === "entry_point")!.value.kind, ValueKind.Name);
});
