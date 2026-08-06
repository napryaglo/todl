# TODL Language Server — LSP Server Design (Spec 2 of 3)

**Parent:** [`2026-07-28-todl-language-server-design.md`](./2026-07-28-todl-language-server-design.md)
(umbrella architecture, Component 2). Depends on **Spec 1 — the analysis core**
([`2026-07-28-todl-language-service-core-design.md`](./2026-07-28-todl-language-service-core-design.md),
DONE). **Spec 3 — the Plexus client** is the follow-on.

**Goal:** Wrap the completed analysis core in a real `vscode-languageserver` LSP server — a
single process that partitions documents into multiple projects, keeps each project's
analysis fresh, and answers every LSP request by delegating to the core. Ships a stdio
binary that both the Plexus client (Spec 3) and a future VS Code extension consume.

**Status:** ✅ Finished

---

## Resolved decisions

| Fork | Decision |
| --- | --- |
| Project model | **One server, multi-project partitioning** — documents assigned to projects by URI prefix. |
| Source modes | **Both** pushed (Plexus) and FS (external), behind a `SourceProvider` seam. |
| FS-mode bases | **No external base resolution** — FS mode validates each workspace as a self-contained project (`bases = []`). |
| Packaging | Subpath export `@pragmatic-lab/todl/language-server` with a `bin` (`todl-language-server`). |
| Transport | stdio (`vscode-languageserver/node`); `createServer(connection)` is transport-agnostic. |
| Sync | `TextDocumentSyncKind.Incremental`; whole-project debounced re-analysis (~200 ms). |

---

## Package & dependencies

- **New source folder** `src/language-server/`, exposed via a new `exports` subpath
  `@pragmatic-lab/todl/language-server`, plus a `bin` field mapping `todl-language-server` to
  the built stdio entry.
- **Depends on:** `@pragmatic-lab/todl/language-service` (the core barrel — imported as the
  public surface, never its internals), `vscode-languageserver` (connection + `TextDocuments`),
  `vscode-languageserver-textdocument` (`TextDocument`), and the already-present
  `vscode-languageserver-types`.
- **Install note:** the two new runtime packages are public/unscoped; with Verdaccio down they
  install from public npm (`--registry=https://registry.npmjs.org`, `--no-save`), reconciling on
  the next registry-up `npm install`. Same path used for `vscode-languageserver-types` in Spec 1.
- **Dependency direction:** server → core → compiler. One-way; the core never imports the server.

**File layout (one responsibility each):**
- `src/language-server/workspace.ts` — the multi-project registry + `SourceProvider` seam.
- `src/language-server/server.ts` — `createServer(connection)`: capabilities, request handlers,
  custom notifications, the debounced re-analysis lifecycle.
- `src/language-server/stdio.ts` — the `bin` entry: build a stdio connection, call
  `createServer`, `listen()`.
- `src/language-server/index.ts` — barrel exporting `createServer` for in-process/testing use.

---

## Project model & source providers

### The registry

`ProjectRegistry` holds `Map<string /* rootUri */, Project>`:

```ts
interface Project {
  rootUri: string;
  bases: TodlDocument[];
  analysis: Analysis | null;
  dirty: boolean;
}
```

A document is assigned to a project by **longest-prefix match** of its URI against the
registered `rootUri`s (`projectFor(uri): Project | null`). Every project's documents live
under a distinct root, so one server partitions cleanly. Registry operations: `register(rootUri)`,
`setBases(rootUri, bases)`, `projectFor(uri)`, `markDirty(rootUri)`, `dirtyProjects()`,
`documentsOf(rootUri)` (filters the `TextDocuments` set by prefix), `remove(rootUri)`.

### The `SourceProvider` seam

The registry doesn't care where roots/sources come from; a provider supplies them:

```ts
interface SourceProvider {
  // Project roots known at startup (FS mode: workspace folders; pushed: none — roots
  // arrive via todl/setBases).
  initialRoots(params: InitializeParams): string[];
  // The SourceFile set to analyze for a project — open-buffer text (pushed) or on-disk
  // *.todl overlaid with open buffers (FS).
  sourcesFor(project: Project, docs: TextDocuments<TextDocument>): SourceFile[];
}
```

- **Pushed provider (Plexus).** `initialRoots` = `[]`. Roots register lazily via `todl/setBases`.
  `sourcesFor` = the live text of open documents under the project root.
- **FS provider (external).** `initialRoots` = the `workspaceFolders`' URIs. `sourcesFor` = the
  `*.todl` files found on disk under the root (via `fs`), with any open document's live text
  overlaid on its on-disk copy. Re-scans on `didChangeWatchedFiles`.

The provider is chosen at `initialize` from `initializationOptions.mode` (`"pushed"` | `"fs"`),
defaulting to `"fs"` when `workspaceFolders` are present, else `"pushed"`.

### FS-mode base boundary (explicit)

Resolving a manifest's `metaModel`/`libraries` bindings into compiled `TodlDocument`s requires a
backend (Plexus's meta-models service); no such backend exists on a bare filesystem. So **FS mode
validates with `bases = []`** — a fully-functional *self-contained* project (all its own `.todl`
analyzed together), but it does not pull in externally-published meta-models it lacks as source.
External-base resolution stays a pushed-mode capability (Plexus resolves and pushes via
`todl/setBases`). This is a stated scope boundary, not a gap.

### Per-project re-analysis

A change to any document marks *its* project dirty. The shared debounce re-runs
`analyze(provider.sourcesFor(project, docs), project.bases)` for each dirty project and
republishes diagnostics for that project's documents only. Projects are independent — editing
project A never re-analyzes project B.

---

## Server: capabilities, handlers, lifecycle

`createServer(connection: Connection)` is the single wiring point (in-memory connection in tests;
stdio in the binary).

### Capabilities (`onInitialize`)

Advertise exactly the core's surface:

- `textDocumentSync: TextDocumentSyncKind.Incremental`
- `completionProvider` (`triggerCharacters: ["&", ":", "-", " "]`)
- `hoverProvider`, `definitionProvider`, `referencesProvider`
- `renameProvider: { prepareProvider: true }`
- `documentSymbolProvider`, `documentFormattingProvider`, `foldingRangeProvider`,
  `workspaceSymbolProvider`, `codeActionProvider`
- `signatureHelpProvider: { triggerCharacters: ["&"] }`
- `semanticTokensProvider: { legend: SEMANTIC_LEGEND, full: true }` — legend taken directly from
  the core's `SEMANTIC_LEGEND`.

`onInitialize` also records `workspaceFolders` (FS roots) and picks the `SourceProvider` from the
mode. `initialRoots` are registered immediately.

### Request handlers (thin delegation)

Each handler resolves the document's project, takes its cached `Analysis`, and calls the matching
core function — results are already `vscode-languageserver-types` and pass straight through:

| LSP request | Core call |
| --- | --- |
| `textDocument/completion` | `completionsAt(a, uri, pos)` |
| `textDocument/hover` | `hoverAt(a, uri, pos)` |
| `textDocument/definition` | `definitionAt(a, uri, pos)` |
| `textDocument/references` | `referencesAt(a, uri, pos, includeDecl)` |
| `textDocument/prepareRename` | `prepareRename(a, uri, pos)` |
| `textDocument/rename` | `renameEdits(...)` → `WorkspaceEdit`, or throw `ResponseError` on `RenameError` |
| `textDocument/documentSymbol` | `documentSymbols(a, uri)` |
| `textDocument/foldingRange` | `foldingRanges(a, uri)` |
| `workspace/symbol` | `workspaceSymbols(a, query)` (across all projects) |
| `textDocument/semanticTokens/full` | `semanticTokens(a, uri)` |
| `textDocument/codeAction` | `codeActions(a, uri, range, diagnostics)` |
| `textDocument/formatting` | `formatDocument(a, uri)` |
| `textDocument/signatureHelp` | `signatureHelpAt(a, uri, pos)` |

If a project has no analysis yet (request races initial load), the handler returns the
empty/null result rather than blocking. `workspace/symbol` merges results across every project's
analysis.

### Custom notifications

- `todl/setBases` — params `{ rootUri: string; bases: TodlDocument[] }`: registers the root if
  new, sets its bases, marks it dirty.
- `todl/refreshBases` — params `{ rootUri: string; bases: TodlDocument[] }`: replaces the bases,
  marks it dirty. (Same shape as `setBases`; a distinct method so the client's Refresh-Bases
  action reads clearly and the server can log/treat it as a deliberate refresh.)

### Lifecycle

`TextDocuments` open/change/close and the base notifications mark the owning project dirty and
schedule one shared debounce (~200 ms). On fire, each dirty project re-analyzes and publishes
`connection.sendDiagnostics({ uri, diagnostics })` per document; a document that goes clean
publishes an empty list so stale squiggles clear. Read-only requests always use the last cached
analysis (stale-tolerant — never block the UI).

### Error handling

A core throw during `analyze` is caught and converted to a project-level diagnostic on each of the
project's documents (mirroring the current in-renderer validation service), so the connection
stays alive. Malformed source yields the core's partial `Analysis` — queries degrade, not crash.

---

## Data flow

**Pushed (Plexus).** `initialize` (`mode: "pushed"`) → per project `todl/setBases {rootUri, bases}`
(registers root + bases) → `didOpen` for every `.todl` under that root (URIs namespaced by root,
e.g. `todl://<projectId>/<relpath>`) → partition by prefix, debounce, `analyze(sources, bases)` per
project → `publishDiagnostics` per document. Edits → `didChange` → re-analyze that project. Republish
a base → `todl/refreshBases`. Hover/nav/etc. → request → core query over cached analysis.

**FS (external).** `initialize` with `workspaceFolders` → each folder registered (bases `[]`) →
provider scans `*.todl` → analyze → publish. `didChangeWatchedFiles`/`didOpen`/`didChange` →
re-scan/overlay → re-analyze.

**Server crash / restart** is the client's concern (Spec 3): on restart the client resends
`setBases` + re-opens documents.

---

## Testing

All headless, no child process — an in-memory duplex stream pair (a `vscode-jsonrpc` message
connection over two `PassThrough` streams) drives a real `createServer`:

- **Lifecycle:** `initialize` → assert advertised capabilities; `didOpen` → a `publishDiagnostics`
  notification arrives.
- **Per-capability wiring:** `didOpen` a fixture, then one request each (completion, hover,
  definition, references, rename, documentSymbol, foldingRange, semanticTokens, codeAction,
  formatting, signatureHelp) asserting the response shape. The *logic* is exhaustively covered in
  the core's own tests; these prove delegation + param conversion.
- **Multi-project:** two projects under distinct roots; a symbol name present in both resolves
  within each independently; editing one republishes only its documents.
- **Pushed bases:** `todl/setBases` with a base `TodlDocument`, then a source referencing a base
  concept → no unresolved diagnostic; `todl/refreshBases` swaps it.
- **FS mode:** point the server at a temp dir of `.todl` files → diagnostics + a `workspace/symbol`
  request resolve; assert no external-base resolution is attempted.

---

## Scope boundaries

- **In:** multi-project pushed mode; FS mode (self-contained); every core capability wired; the
  stdio `bin`; in-memory integration tests.
- **Flagged:** FS mode resolves no external bases (stated boundary).
- **Out (later specs):** the Plexus client — `utilityProcess` fork, IPC relay, hand-rolled Monaco
  adapters, `WorkspaceEdit` application, model-URI fix (Spec 3); the VS Code extension packaging.
  This spec's stdio binary is what both consume.

---

## Open risks

- **`vscode-languageserver` version drift.** Pin a current major and assert capabilities in a test
  so an upgrade that changes defaults is caught. Mitigation: the lifecycle test.
- **URI-prefix collisions.** Two project roots where one is a prefix of the other would mis-assign
  documents. Mitigation: longest-prefix match (already specified); a test with nested-looking roots.
- **Debounce vs. request races.** A request arriving before the first analysis returns null/empty
  (specified) rather than blocking; a later re-analysis then serves it. Mitigation: a
  request-before-analysis test.
