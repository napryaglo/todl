import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { MetaKind } from "../../model/kinds.js";

function repo(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).model;
}

test("a flat taxonomy loads terms typed by the taxonomy, no Narrower edges", () => {
  const m = repo(`taxonomy color { terms { | red { label = "Red"; } | blue {} } }`);
  assert.equal(m.resolve("color")?.typeOf, MetaKind.Taxonomy);
  assert.equal(m.resolve("color.red")?.typeOf, "color");
  assert.equal(m.resolve("color.red")?.attrs.get("label"), "Red");
  assert.deepEqual(m.narrowerOf("color.red"), []);
});

test("a nested taxonomy loads Narrower edges and answers branch queries", () => {
  const m = repo(`taxonomy cc { terms { | surface { | api-service {} | web-portal {} } | data-store {} } }`);
  assert.deepEqual(m.narrowerOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
  assert.deepEqual(m.broaderOf("cc.api-service"), ["cc.surface"]);
  assert.deepEqual(m.descendantsOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
});
