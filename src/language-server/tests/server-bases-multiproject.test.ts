import { test } from "node:test";
import assert from "node:assert/strict";
import { check, toJSON } from "@pragmatic-lab/todl";
import { startServer, pushedInit } from "./harness.js";

// Compile a base model defining `element` with a REQUIRED `label` field. The
// base's schema is what makes an instance missing `label` an error — proving the
// pushed base actually reached the analysis (an unresolved reference, by
// contrast, is silently stubbed and would never diagnose).
function baseDoc(): unknown {
  const { model } = check([{ uri: "base.todl", text: "namespace base {\n  concept element { label : string; }\n}" }]);
  return toJSON(model);
}

function waitDiag(client: { onNotification: Function }, uri: string) {
  return new Promise<{ message?: string }[]>((resolve) => {
    client.onNotification("textDocument/publishDiagnostics", (p: { uri: string; diagnostics: { message?: string }[] }) => {
      if (p.uri === uri) resolve(p.diagnostics);
    });
  });
}

test("a pushed base's schema drives validation (required field from the base)", async () => {
  const { client, dispose } = startServer();
  await client.sendRequest("initialize", pushedInit());
  client.sendNotification("initialized", {});
  client.sendNotification("todl/setBases", { rootUri: "todl://p/", bases: [baseDoc()] });
  const diag = waitDiag(client, "todl://p/m.todl");
  // An `element` instance missing the base-declared required `label`.
  client.sendNotification("textDocument/didOpen", { textDocument: {
    uri: "todl://p/m.todl", languageId: "todl", version: 1,
    text: "namespace m {\n  element e { }\n}",
  } });
  const diagnostics = await diag;
  assert.ok(diagnostics.length >= 1);
  assert.ok(diagnostics.some((d) => (d.message ?? "").includes("label")));
  dispose();
});

test("two projects validate independently", async () => {
  const { client, dispose } = startServer();
  await client.sendRequest("initialize", pushedInit());
  client.sendNotification("initialized", {});
  client.sendNotification("todl/setBases", { rootUri: "todl://a/", bases: [] });
  client.sendNotification("todl/setBases", { rootUri: "todl://b/", bases: [] });
  const diagB = waitDiag(client, "todl://b/x.todl");
  client.sendNotification("textDocument/didOpen", { textDocument: { uri: "todl://a/x.todl", languageId: "todl", version: 1, text: "namespace a {\n  concept a1 { }\n}" } });
  client.sendNotification("textDocument/didOpen", { textDocument: { uri: "todl://b/x.todl", languageId: "todl", version: 1, text: "namespace b {\n  concept b1 { }\n}" } });
  assert.deepEqual(await diagB, []);   // b is clean and published on its own
  dispose();
});
