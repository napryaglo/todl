import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { classifyPosition, ContextKind } from "../classifier.js";

test("classifies a reference occurrence as Identifier with its resolved symbol", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept a { }\n  concept b : a‸ { }\n}");
  const ctx = classifyPosition(analysis, uri, positions[0]);
  assert.equal(ctx.kind, ContextKind.Identifier);
  assert.equal(ctx.symbol, "a");
});

test("classifies a field-type slot after a colon", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept a { name : ‸ }\n}");
  assert.equal(classifyPosition(analysis, uri, positions[0]).kind, ContextKind.TypeSlot);
});

test("classifies a relationship target slot after an arrow", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept a { relationship r -> ‸ }\n}");
  assert.equal(classifyPosition(analysis, uri, positions[0]).kind, ContextKind.RelationshipTarget);
});

test("classifies a ref-value slot after an ampersand", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept a { }\n  a x { }\n  a y { peer = &‸ }\n}");
  assert.equal(classifyPosition(analysis, uri, positions[0]).kind, ContextKind.RefValue);
});
