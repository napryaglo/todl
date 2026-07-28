import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, pushedInit } from "./harness.js";

function opened(uri: string, text: string) {
  return { textDocument: { uri, languageId: "todl", version: 1, text } };
}

test("publishes diagnostics for an opened document with a required-missing error", async () => {
  const { client, dispose } = startServer();
  await client.sendRequest("initialize", pushedInit());
  client.sendNotification("initialized", {});
  // Register the project root, then open a file with a missing required field.
  client.sendNotification("todl/setBases", { rootUri: "todl://p/", bases: [] });

  const got = new Promise<{ uri: string; diagnostics: unknown[] }>((resolve) => {
    client.onNotification("textDocument/publishDiagnostics", (p) => {
      if ((p as { diagnostics: unknown[] }).diagnostics.length > 0) resolve(p as { uri: string; diagnostics: unknown[] });
    });
  });
  client.sendNotification("textDocument/didOpen", opened("todl://p/a.todl",
    "namespace demo {\n  primitive string { }\n  concept person { name : string; }\n  person alice { }\n}"));

  const published = await got;
  assert.equal(published.uri, "todl://p/a.todl");
  assert.ok(published.diagnostics.length >= 1);
  dispose();
});
