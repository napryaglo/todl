import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { DiagnosticCode } from "../../validate/validate.js";

function loaded(text: string) {
  return loadFiles([{ uri: "s.todl", text }]);
}

const BASE = `namespace d {
  concept technology { label : string; }
  concept component { label : string; category : string; implemented-by : technology?; }
  model microsoft : d {
    technology m365-copilot { label = "Copilot"; }
    component a { label = "A"; category = draft; implemented-by = m365-copilot; }
    component b { label = "B"; category = draft; implemented-by = m365-copilot; }
  }
}`;

test("concept-typed field becomes a shared reference edge, not an attr", () => {
  const m = loaded(BASE).model;
  assert.deepEqual(m.related("a", EdgeKind.Relationship, Direction.Out, "implemented-by"), ["m365-copilot"]);
  assert.deepEqual(m.related("b", EdgeKind.Relationship, Direction.Out, "implemented-by"), ["m365-copilot"]);
  assert.deepEqual(
    m.related("m365-copilot", EdgeKind.Relationship, Direction.In, "implemented-by").sort(),
    ["a", "b"],
  );
  assert.equal(m.resolve("a")?.attrs.has("implemented-by"), false);
});

test("primitive-typed field given a bare name stays a scalar attr, not an edge", () => {
  const m = loaded(BASE).model;
  assert.equal(m.resolve("a")?.attrs.get("category"), "draft");
  assert.deepEqual(m.related("a", EdgeKind.Relationship, Direction.Out, "category"), []);
  assert.equal(m.resolve("a")?.attrs.get("label"), "A");
});

test("a concept-typed field given a quoted string is a value-kind error", () => {
  const bad = `namespace d {
    concept technology { label : string; }
    concept component { implemented-by : technology?; }
    model microsoft : d { component a { implemented-by = "m365-copilot"; } }
  }`;
  const codes = loaded(bad).diagnostics.map((d) => d.code);
  assert.ok(codes.includes(DiagnosticCode.MemberValueKind));
});
