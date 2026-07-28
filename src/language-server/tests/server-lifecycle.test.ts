import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, pushedInit } from "./harness.js";

test("initialize advertises the TODL capabilities", async () => {
  const { client, dispose } = startServer();
  const result = await client.sendRequest("initialize", pushedInit()) as { capabilities: Record<string, unknown> };
  const caps = result.capabilities;
  assert.ok(caps.completionProvider);
  assert.ok(caps.hoverProvider);
  assert.ok(caps.renameProvider);
  assert.ok(caps.semanticTokensProvider);
  dispose();
});
