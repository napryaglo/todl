import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { DiagnosticCode } from "../../validate/validate.js";

function loaded(text: string) {
  return loadFiles([{ uri: "s.todl", text }]);
}

const BASE = `namespace d {
  concept Technology { label : string; }
  concept Component { label : string; category : string; implementedBy : Technology?; }
  model microsoft : d {
    Technology m365Copilot { label = "Copilot"; }
    Component a { label = "A"; category = draft; implementedBy = m365Copilot; }
    Component b { label = "B"; category = draft; implementedBy = m365Copilot; }
  }
}`;

test("concept-typed field becomes a shared reference edge, not an attr", () => {
  const m = loaded(BASE).model;
  assert.deepEqual(m.related("a", EdgeKind.Relationship, Direction.Out, "implementedBy"), ["m365Copilot"]);
  assert.deepEqual(m.related("b", EdgeKind.Relationship, Direction.Out, "implementedBy"), ["m365Copilot"]);
  assert.deepEqual(
    m.related("m365Copilot", EdgeKind.Relationship, Direction.In, "implementedBy").sort(),
    ["a", "b"],
  );
  assert.equal(m.resolve("a")?.attrs.has("implementedBy"), false);
});

test("primitive-typed field given a bare name stays a scalar attr, not an edge", () => {
  const m = loaded(BASE).model;
  assert.equal(m.resolve("a")?.attrs.get("category"), "draft");
  assert.deepEqual(m.related("a", EdgeKind.Relationship, Direction.Out, "category"), []);
  assert.equal(m.resolve("a")?.attrs.get("label"), "A");
});

test("a concept-typed field given a quoted string is a value-kind error", () => {
  const bad = `namespace d {
    concept Technology { label : string; }
    concept Component { implementedBy : Technology?; }
    model microsoft : d { Component a { implementedBy = "m365-copilot"; } }
  }`;
  const codes = loaded(bad).diagnostics.map((d) => d.code);
  assert.ok(codes.includes(DiagnosticCode.MemberValueKind));
});
