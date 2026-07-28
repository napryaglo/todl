import {
  createConnection, TextDocuments, TextDocumentSyncKind,
  type Connection, type InitializeParams, type InitializeResult,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SEMANTIC_LEGEND, analyze } from "@pragmatic-lab/todl/language-service";
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
    scheduleRevalidate();   // FS mode: analyze the scanned roots once after init
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

  let timer: ReturnType<typeof setTimeout> | undefined;
  function scheduleRevalidate(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; revalidate(); }, 200);
  }

  function revalidate(): void {
    for (const project of registry.dirtyProjects()) {
      project.dirty = false;
      const sources = provider.sourcesFor(project, documents);
      const analysis = analyze(sources, project.bases);
      project.analysis = analysis;
      for (const [uri, diagnostics] of analysis.diagnosticsByUri) {
        connection.sendDiagnostics({ uri, diagnostics });
      }
    }
  }

  const touch = (uri: string): void => {
    const project = registry.projectFor(uri);
    if (project !== null) { project.dirty = true; scheduleRevalidate(); }
  };

  documents.onDidChangeContent((e) => touch(e.document.uri));
  documents.onDidClose((e) => touch(e.document.uri));

  connection.onNotification("todl/setBases", (p: { rootUri: string; bases: [] }) => {
    registry.setBases(p.rootUri, p.bases); scheduleRevalidate();
  });
  connection.onNotification("todl/refreshBases", (p: { rootUri: string; bases: [] }) => {
    registry.setBases(p.rootUri, p.bases); scheduleRevalidate();
  });

  documents.listen(connection);
}
