import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startServer, fsInit } from "./harness.js";

test("FS mode scans the workspace, publishes diagnostics, and answers workspace symbols", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-lsp-fs-"));
  writeFileSync(join(dir, "m.todl"), "namespace m {\n  concept gadget { }\n}");
  const rootUri = pathToFileURL(dir).href.replace(/\/?$/, "/");

  const { client, dispose } = startServer();
  const gotDiag = new Promise<void>((resolve) => {
    client.onNotification("textDocument/publishDiagnostics", () => resolve());
  });
  await client.sendRequest("initialize", fsInit(rootUri));
  client.sendNotification("initialized", {});
  await gotDiag;   // the scanned file was analyzed + published

  const syms = await client.sendRequest("workspace/symbol", { query: "gadget" }) as { name: string }[];
  assert.deepEqual(syms.map((s) => s.name), ["gadget"]);
  dispose();
});
