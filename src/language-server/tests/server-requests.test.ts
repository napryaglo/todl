import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, pushedInit } from "./harness.js";

const SRC = "namespace demo {\n  concept animal { }\n  concept dog : animal { }\n}";

async function ready() {
  const h = startServer();
  await h.client.sendRequest("initialize", pushedInit());
  h.client.sendNotification("initialized", {});
  h.client.sendNotification("todl/setBases", { rootUri: "todl://p/", bases: [] });
  const opened = new Promise<void>((resolve) => {
    h.client.onNotification("textDocument/publishDiagnostics", () => resolve());
  });
  h.client.sendNotification("textDocument/didOpen", { textDocument: { uri: "todl://p/a.todl", languageId: "todl", version: 1, text: SRC } });
  await opened;   // analysis is now cached
  return h;
}

test("hover and definition delegate to the core", async () => {
  const h = await ready();
  // Cursor on the `animal` reference in `: animal` (line 2, char 16).
  const hover = await h.client.sendRequest("textDocument/hover", {
    textDocument: { uri: "todl://p/a.todl" }, position: { line: 2, character: 16 },
  }) as { contents: { value: string } } | null;
  assert.match(hover!.contents.value, /animal/);

  const def = await h.client.sendRequest("textDocument/definition", {
    textDocument: { uri: "todl://p/a.todl" }, position: { line: 2, character: 16 },
  }) as { range: { start: { line: number } } } | null;
  assert.equal(def!.range.start.line, 1);
  h.dispose();
});

test("document symbols delegate to the core", async () => {
  const h = await ready();
  const syms = await h.client.sendRequest("textDocument/documentSymbol", {
    textDocument: { uri: "todl://p/a.todl" },
  }) as { name: string }[];
  assert.deepEqual(syms.map((s) => s.name).sort(), ["animal", "dog"]);
  h.dispose();
});
