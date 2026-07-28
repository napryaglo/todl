import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../index.js";

test("the language-server barrel exports createServer", () => {
  assert.equal(typeof createServer, "function");
});
