import { PassThrough } from "node:stream";
import { createConnection } from "vscode-languageserver/node.js";
import { StreamMessageReader, StreamMessageWriter, createMessageConnection, type MessageConnection } from "vscode-jsonrpc/node.js";
import { createServer } from "../server.js";
import { FsSourceProvider } from "../workspace-fs.js";

// An in-memory client↔server pair over two pipes — no child process.
export function startServer(): { client: MessageConnection; dispose: () => void } {
  const c2s = new PassThrough();
  const s2c = new PassThrough();
  const server = createConnection(new StreamMessageReader(c2s), new StreamMessageWriter(s2c));
  createServer(server, () => new FsSourceProvider());
  server.listen();
  const client = createMessageConnection(new StreamMessageReader(s2c), new StreamMessageWriter(c2s));
  client.listen();
  return { client, dispose: () => { client.dispose(); c2s.destroy(); s2c.destroy(); } };
}

// A minimal initialize params object for pushed mode.
export function pushedInit() {
  return { processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: "pushed" }, workspaceFolders: null };
}

// Initialize params for FS mode against a workspace folder URI.
export function fsInit(folderUri: string) {
  return { processId: null, rootUri: folderUri, capabilities: {}, initializationOptions: { mode: "fs" },
    workspaceFolders: [{ uri: folderUri, name: "ws" }] };
}
