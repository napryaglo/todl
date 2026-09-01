// The TODL language server, running in a Web Worker over a browser message
// transport. createServer is transport-neutral + fs-free (see the Phase-6 TODL
// core refactor); with no fs-provider factory it stays in pushed mode — the
// client sends source text via didOpen/didChange.
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";
import { createServer } from "@pragmatic-tech-ai/todl/language-server";

const connection = createConnection(new BrowserMessageReader(self as never), new BrowserMessageWriter(self as never));
createServer(connection);
connection.listen();
