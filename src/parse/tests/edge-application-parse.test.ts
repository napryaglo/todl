import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, type ModelDecl } from "../ast.js";

function model(text: string): ModelDecl {
  return parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Model) as ModelDecl;
}

test("an edge application in a model body parses left/glyph/right", () => {
  const edges = model(`namespace t { model M : t { agent ~> orchestrator; } }`).edges;
  assert.equal(edges.length, 1);
  assert.equal(edges[0].left, "agent");
  assert.equal(edges[0].glyph, "~>");
  assert.equal(edges[0].right, "orchestrator");
  assert.deepEqual(edges[0].body, []);
});

test("an edge application with a body captures extra assignments", () => {
  const edges = model(`namespace t { model M : t { agent ~> orchestrator { type = sync; }; } }`).edges;
  assert.equal(edges[0].body.find((a) => a.name === "type")?.value.kind !== undefined, true);
});

test("dotted operands parse", () => {
  const edges = model(`namespace t { model M : t { lib.a ==> lib.b; } }`).edges;
  assert.equal(edges[0].left, "lib.a");
  assert.equal(edges[0].right, "lib.b");
});

test("an edge inside an instance body attaches to that instance", () => {
  const m = model(`namespace t { model M : t { component c1 { a ~> b; } } }`);
  assert.equal(m.instances[0].edges.length, 1);
  assert.equal(m.instances[0].edges[0].left, "a");
});

test("a normal assignment is still an assignment, not an edge", () => {
  const m = model(`namespace t { model M : t { component c1 { label = x; } } }`);
  assert.equal(m.instances[0].assignments[0].name, "label");
  assert.equal(m.instances[0].edges.length, 0);
});
