import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../../parse/loader.js";
import { toJSON, fromJSON } from "../json.js";

test("toJSON/fromJSON round-trips a nested taxonomy including Narrower edges", () => {
  const src = `namespace n { taxonomy cc { terms { | surface { | api-service {} } | data-store {} } } }`;
  const original = load([{ uri: "t.todl", text: src }]).model;
  const rebuilt = fromJSON(toJSON(original));
  assert.deepEqual(rebuilt.narrowerOf("cc.surface"), ["cc.api-service"]);
  assert.deepEqual(rebuilt.broaderOf("cc.api-service"), ["cc.surface"]);
  assert.equal(rebuilt.resolve("cc")?.typeOf, "taxonomy");
});
