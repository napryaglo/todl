import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../parse/parser.js";
import { buildReferenceIndex, Role } from "../reference-index.js";

function indexOf(src: string, uri = "d.todl") {
  const files = new Map([[uri, parse(src, uri).namespace]]);
  return buildReferenceIndex(files);
}

test("records extends, field-type, relationship-target and ref occurrences", () => {
  const idx = indexOf([
    "namespace demo {",
    "  concept animal { }",
    "  concept dog : animal { legs : number; relationship owner -> person []; }",
    "  dog rex { }",
    "  person p { pet = &rex; }",
    "}",
  ].join("\n"));
  const animalRefs = idx.get("animal");
  assert.equal(animalRefs.length, 1);
  assert.equal(animalRefs[0].role, Role.Extends);
  assert.equal(idx.get("number")[0].role, Role.FieldType);
  assert.equal(idx.get("person")[0].role, Role.RelationshipTarget);
  assert.equal(idx.get("rex")[0].role, Role.RefValue);
  assert.equal(idx.get("dog")[0].role, Role.InstanceConcept);
});

test("occurrenceAt finds the occurrence under a position", () => {
  const idx = indexOf("namespace demo {\n  concept a { }\n  concept b : a { }\n}");
  // `a` in `: a` is line 3 (0-based line 2), character 14 (the colon is at 13).
  const occ = idx.occurrenceAt("d.todl", { line: 2, character: 14 });
  assert.equal(occ?.symbol, "a");
  assert.equal(occ?.role, Role.Extends);
});
