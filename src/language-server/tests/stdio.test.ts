import { test } from "node:test";
import assert from "node:assert/strict";

test("stdio entry's server module exposes the expected factory", async () => {
  // Importing stdio.ts would start reading process.stdin, so we assert the
  // server module it depends on exposes the expected factory instead.
  const mod = await import("../server.js");
  assert.equal(typeof mod.createServer, "function");
  assert.equal(typeof mod.createConnection, "function");
});
