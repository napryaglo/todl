import {
  TextDocuments, TextDocumentSyncKind, ResponseError, ErrorCodes,
  type Connection, type InitializeParams, type InitializeResult,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  SEMANTIC_LEGEND, analyze, type Analysis,
  completionsAt, hoverAt, definitionAt, referencesAt, prepareRename, renameEdits,
  documentSymbols, foldingRanges, workspaceSymbols, semanticTokens, codeActions,
  formatDocument, signatureHelpAt,
} from "@pragmatic-tech-ai/todl/language-service";
import { ProjectRegistry, PushedSourceProvider, type SourceProvider } from "./workspace.js";

export function createServer(connection: Connection, makeFsProvider?: () => SourceProvider): void {
  const documents = new TextDocuments(TextDocument);
  const registry = new ProjectRegistry();
  let provider: SourceProvider = new PushedSourceProvider();

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    const folders = (params.workspaceFolders ?? []).map((f) => f.uri);
    const opts = params.initializationOptions as { mode?: string } | undefined;
    const mode = opts?.mode ?? (folders.length > 0 ? "fs" : "pushed");
    provider = mode === "fs" ? (makeFsProvider?.() ?? new PushedSourceProvider()) : new PushedSourceProvider();
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

  const analysisFor = (uri: string): Analysis | null => registry.projectFor(uri)?.analysis ?? null;

  connection.onCompletion((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? [] : completionsAt(a, p.textDocument.uri, p.position);
  });
  connection.onHover((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? null : hoverAt(a, p.textDocument.uri, p.position);
  });
  connection.onDefinition((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? null : definitionAt(a, p.textDocument.uri, p.position);
  });
  connection.onReferences((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? [] : referencesAt(a, p.textDocument.uri, p.position, p.context.includeDeclaration);
  });
  connection.onPrepareRename((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? null : prepareRename(a, p.textDocument.uri, p.position);
  });
  connection.onRenameRequest((p) => {
    const a = analysisFor(p.textDocument.uri);
    if (a === null) return null;
    const edit = renameEdits(a, p.textDocument.uri, p.position, p.newName);
    if ("error" in edit) throw new ResponseError(ErrorCodes.InvalidRequest, edit.error);
    return edit;
  });
  connection.onDocumentSymbol((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? [] : documentSymbols(a, p.textDocument.uri);
  });
  connection.onFoldingRanges((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? [] : foldingRanges(a, p.textDocument.uri);
  });
  connection.onDocumentFormatting((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? [] : formatDocument(a, p.textDocument.uri);
  });
  connection.onCodeAction((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? [] : codeActions(a, p.textDocument.uri, p.range, p.context.diagnostics);
  });
  connection.onSignatureHelp((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? null : signatureHelpAt(a, p.textDocument.uri, p.position);
  });
  connection.onWorkspaceSymbol((p) => {
    const out = [];
    for (const project of registry.all()) {
      if (project.analysis !== null) out.push(...workspaceSymbols(project.analysis, p.query));
    }
    return out;
  });
  connection.languages.semanticTokens.on((p) => {
    const a = analysisFor(p.textDocument.uri);
    return a === null ? { data: [] } : semanticTokens(a, p.textDocument.uri);
  });

  documents.listen(connection);
}
