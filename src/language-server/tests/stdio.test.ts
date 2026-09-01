import { test } from "node:test";
import assert from "node:assert/strict";

test("stdio entry's server module exposes the transport-neutral factory", async () => {
  // Importing stdio.ts would start reading process.stdin, so we assert the
  // server module it depends on exposes the expected factory instead. The server
  // core is transport-neutral now — the stdio entry supplies `createConnection`
  // (from vscode-languageserver/node) and the fs source provider itself.
  const mod = await import("../server.js");
  assert.equal(typeof mod.createServer, "function");
});
