import { test } from "node:test";
import assert from "node:assert/strict";

import { load as loadFiles } from "../../parse/loader.js";
import { toMetaModule } from "../js-module.js";

function load(texts: string[]) {
  return loadFiles(texts.map((text, i) => ({ uri: `s${i}.todl`, text }))).model;
}

test("a union relationship emits a multi-element targets array", () => {
  const model = load([
    `namespace n { concept actor {} concept component {}
      concept edge { relationship from -> actor | component[]; } }`,
  ]);
  const js = toMetaModule(model, { slug: "n" });
  assert.match(js, /from: \{ targets: \["actor", "component"\], cardinality: "\*" \},/);
  assert.doesNotMatch(js, /from: \{ target: /);
});
