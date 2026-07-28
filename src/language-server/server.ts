import {
  createConnection, TextDocuments, TextDocumentSyncKind,
  type Connection, type InitializeParams, type InitializeResult,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SEMANTIC_LEGEND } from "@pragmatic-lab/todl/language-service";
import { ProjectRegistry, PushedSourceProvider, FsSourceProvider, type SourceProvider } from "./workspace.js";

export { createConnection };

export function createServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);
  const registry = new ProjectRegistry();
  let provider: SourceProvider = new PushedSourceProvider();

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    const folders = (params.workspaceFolders ?? []).map((f) => f.uri);
    const opts = params.initializationOptions as { mode?: string } | undefined;
    const mode = opts?.mode ?? (folders.length > 0 ? "fs" : "pushed");
    provider = mode === "fs" ? new FsSourceProvider() : new PushedSourceProvider();
    for (const root of provider.initialRoots(folders)) registry.register(root);
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: ["&", ":", "-", " "] },
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        documentSymbolProvider: true,
        documentFormattingProvider: true,
        foldingRangeProvider: true,
        workspaceSymbolProvider: true,
        codeActionProvider: true,
        signatureHelpProvider: { triggerCharacters: ["&"] },
        semanticTokensProvider: { legend: SEMANTIC_LEGEND, full: true },
      },
    };
  });

  documents.listen(connection);
}
