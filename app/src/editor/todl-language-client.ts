import * as monaco from "monaco-editor";
import { BrowserMessageReader, BrowserMessageWriter } from "vscode-jsonrpc/browser";
import { createMessageConnection, type MessageConnection } from "vscode-jsonrpc";
import { toMarker, type LspDiagnostic, type LspPosition } from "./lsp-monaco.js";

/** Fixed in-browser document URI the playground edits, and the project root it
 *  lives under (registered so the server analyzes it in pushed mode). */
export const PLAYGROUND_ROOT = "inmemory://";
export const PLAYGROUND_URI = "inmemory://playground.todl";
const MARKER_OWNER = "todl";

/** Owns the TODL language-server Web Worker and the JSON-RPC connection, mirrors
 *  the editor into the server (didOpen/didChange), turns publishDiagnostics into
 *  Monaco markers, and exposes request() for hover/completion providers. */
export class TodlLanguageClient {
  private readonly worker: Worker;
  private readonly conn: MessageConnection;
  private version = 0;
  private ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL("./todl-lsp.worker.ts", import.meta.url), { type: "module" });
    this.conn = createMessageConnection(new BrowserMessageReader(this.worker), new BrowserMessageWriter(this.worker));
    this.conn.listen();
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.conn.sendRequest("initialize", {
      processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: "pushed" },
    });
    this.conn.sendNotification("initialized", {});
    this.conn.onNotification("textDocument/publishDiagnostics", (p: { uri: string; diagnostics: LspDiagnostic[] }) => {
      const model = monaco.editor.getModel(monaco.Uri.parse(p.uri));
      if (model) monaco.editor.setModelMarkers(model, MARKER_OWNER, p.diagnostics.map(toMarker));
    });
    // Register the playground's project root so pushed-mode documents under it
    // get analyzed (no workspace folders on the web).
    this.conn.sendNotification("todl/setBases", { rootUri: PLAYGROUND_ROOT, bases: [] });
  }

  /** Push the current editor text to the server (didOpen first, then didChange). */
  async openOrUpdate(text: string): Promise<void> {
    await this.ready;
    if (this.version === 0) {
      this.version = 1;
      this.conn.sendNotification("textDocument/didOpen", {
        textDocument: { uri: PLAYGROUND_URI, languageId: "todl", version: this.version, text },
      });
    } else {
      this.version += 1;
      this.conn.sendNotification("textDocument/didChange", {
        textDocument: { uri: PLAYGROUND_URI, version: this.version },
        contentChanges: [{ text }],
      });
    }
  }

  /** Send an LSP request for the playground document at a position. */
  async request<T>(method: string, position?: LspPosition): Promise<T | null> {
    await this.ready;
    return (await this.conn.sendRequest(method, {
      textDocument: { uri: PLAYGROUND_URI }, ...(position ? { position } : {}),
    })) as T | null;
  }
}
