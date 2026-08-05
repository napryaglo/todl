import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../../parse/loader.js";

function model(text: string) {
  return loadFiles([{ uri: "s.todl", text }]).model;
}

const SRC = `namespace d {
  concept technology { label : string; }
  concept component { label : string; implemented-by : technology?; }
  model m : d {
    technology t { label = "T"; }
    component c { label = "C"; implemented-by = t; }
  }
}`;

test("effectiveFields holds primitives only; concept fields live in effectiveRelationships", () => {
  const m = model(SRC);
  assert.equal(m.effectiveFields("c").get("label"), "C");
  assert.equal(m.effectiveFields("c").has("implemented-by"), false);
  assert.deepEqual(m.effectiveRelationships("c").get("implemented-by"), ["t"]);
});
