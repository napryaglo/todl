// TEMP Phase-6 Task-2 boot spike — proves the Monaco + Web-Worker-LSP stack
// bundles and boots in the app before deeper wiring. Deleted in Task 6.
import type { Border } from "@pragmatic-tech-ai/mural/basic";
import { BrowserMessageReader, BrowserMessageWriter } from "vscode-jsonrpc/browser";
import { createMessageConnection } from "vscode-jsonrpc";
import { MonacoEditorHost } from "./monaco-editor-host.js";
import { registerTodlLanguage } from "./todl-monarch.js";

export function runBootSpike(root: Border): void {
  registerTodlLanguage();

  const editor = new MonacoEditorHost();
  editor.Text = "namespace app { concept C { label : string; } }";
  root.SetChild(editor);   // replace the AppVM host with the editor (Root already set)

  const worker = new Worker(new URL("./todl-lsp.worker.ts", import.meta.url), { type: "module" });
  const conn = createMessageConnection(new BrowserMessageReader(worker), new BrowserMessageWriter(worker));
  conn.listen();
  void conn
    .sendRequest("initialize", { processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: "pushed" } })
    .then((r) => {
      const hover = (r as { capabilities?: { hoverProvider?: unknown } })?.capabilities?.hoverProvider;
      console.log("[lsp] initialized hoverProvider=", JSON.stringify(hover));
    })
    .catch((e) => console.error("[lsp] initialize failed", e));
}
