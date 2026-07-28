import { createConnection, createServer } from "./server.js";

// The stdio entry point: Electron main forks this, and an external editor
// (e.g. a VS Code extension) spawns the same file.
const connection = createConnection(process.stdin, process.stdout);
createServer(connection);
connection.listen();
