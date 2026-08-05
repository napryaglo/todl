import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { __test__ } from "../loader.js";

function model(text: string) {
  return loadFiles([{ uri: "s.todl", text }]).model;
}

const SRC = `namespace d {
  concept technology { label : string; }
  concept component { label : string; implemented-by : technology?; }
  taxonomy category : represents component { term alpha { label = "A"; } }
}`;

test("field typed by a concept is reference-like", () => {
  const m = model(SRC);
  assert.equal(__test__.isReferenceMember(m, "component", "implemented-by"), true);
});

test("field typed by a primitive is value-like", () => {
  const m = model(SRC);
  assert.equal(__test__.isReferenceMember(m, "component", "label"), false);
});

test("a type resolving to a taxonomy is reference-like", () => {
  const m = model(SRC);
  assert.equal(__test__.isReferenceType(m, "category"), true);
  assert.equal(__test__.isReferenceType(m, "string"), false);
  assert.equal(__test__.isReferenceType(m, "does-not-exist"), false);
});
