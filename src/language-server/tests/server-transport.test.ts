import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, pushedInit } from "./harness.js";

// Proves createServer is transport-neutral (runs over an in-memory JSON-RPC pair,
// no stdio) and works in pushed mode with no filesystem — the exact shape the
// browser Web Worker uses. Guards the Phase-6 browser LSP.
test("createServer initializes over an in-memory connection and answers in pushed mode", async () => {
  const { client, dispose } = startServer();
  try {
    const init: any = await client.sendRequest("initialize", pushedInit());
    assert.equal(init.capabilities.hoverProvider, true);
    assert.ok(init.capabilities.completionProvider, "completion advertised");

    const uri = "inmemory://t.todl";
    client.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "todl", version: 1, text: "namespace app { concept C { label : string; } }" },
    });
    // A hover request must resolve (result or null) without throwing over the wire.
    const hover = await client.sendRequest("textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 17 } });
    assert.ok(hover === null || typeof hover === "object");
  } finally {
    dispose();
  }
});
