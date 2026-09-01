import { createConnection } from "vscode-languageserver/node.js";
import { createServer } from "./server.js";
import { FsSourceProvider } from "./workspace-fs.js";

// The stdio entry point: Electron main forks this, and an external editor
// (e.g. a VS Code extension) spawns the same file. FS source discovery is
// injected here so the server core stays browser-safe.
const connection = createConnection(process.stdin, process.stdout);
createServer(connection, () => new FsSourceProvider());
connection.listen();
