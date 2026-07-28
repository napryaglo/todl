import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { definitionAt, referencesAt } from "../navigation.js";

const SRC = [
  "namespace demo {",       // line 0
  "  concept animal { }",   // line 1 — `animal` defined here
  "  concept dog : ani‸mal { }", // line 2 — reference (cursor here)
  "  animal a { }",         // line 3 — another reference (instance concept)
  "}",
].join("\n");

test("definitionAt jumps from a reference to the defining span", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const loc = definitionAt(analysis, uri, positions[0]!);
  assert.equal(loc?.uri, "d.todl");
  assert.equal(loc?.range.start.line, 1);   // the `concept animal` line (0-based)
});

test("referencesAt lists every occurrence, optionally including the definition", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const refs = referencesAt(analysis, uri, positions[0]!, false);
  assert.equal(refs.length, 2);             // the extends ref + the instance concept ref
  const withDecl = referencesAt(analysis, uri, positions[0]!, true);
  assert.equal(withDecl.length, 3);         // + the definition
});
