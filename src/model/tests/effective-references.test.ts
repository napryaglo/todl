import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../../parse/loader.js";

function model(text: string) {
  return loadFiles([{ uri: "s.todl", text }]).model;
}

const SRC = `namespace d {
  concept Technology { label : string; }
  concept Component { label : string; implementedBy : Technology?; }
  model m : d {
    Technology t { label = "T"; }
    Component c { label = "C"; implementedBy = t; }
  }
}`;

test("effectiveFields holds primitives only; concept fields live in effectiveRelationships", () => {
  const m = model(SRC);
  assert.equal(m.effectiveFields("c").get("label"), "C");
  assert.equal(m.effectiveFields("c").has("implementedBy"), false);
  assert.deepEqual(m.effectiveRelationships("c").get("implementedBy"), ["t"]);
});
