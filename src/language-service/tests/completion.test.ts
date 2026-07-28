import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { completionsAt } from "../completion.js";

const labels = (items: { label: string }[]): string[] => items.map((i) => i.label).sort();

test("a field-type slot offers concepts and primitives", () => {
  const { analysis, positions, uri } = fixture("d.todl", [
    "namespace demo {",
    "  primitive string { }",
    "  concept person { }",
    "  concept dog { owner : ‸ }",
    "}",
  ].join("\n"));
  const got = labels(completionsAt(analysis, uri, positions[0]));
  assert.ok(got.includes("string"));
  assert.ok(got.includes("person"));
});

test("a ref-value slot offers instances of the field's target concept", () => {
  const { analysis, positions, uri } = fixture("d.todl", [
    "namespace demo {",
    "  concept person { }",
    "  concept dog { relationship owner -> person []; }",
    "  person alice { }",
    "  person bob { }",
    "  dog rex { owner = &‸ }",
    "}",
  ].join("\n"));
  const got = labels(completionsAt(analysis, uri, positions[0]));
  assert.deepEqual(got, ["alice", "bob"]);
});

test("top-level offers declaration keywords", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  ‸\n}");
  const got = completionsAt(analysis, uri, positions[0]).map((i) => i.label);
  assert.ok(got.includes("concept"));
  assert.ok(got.includes("primitive"));
});
