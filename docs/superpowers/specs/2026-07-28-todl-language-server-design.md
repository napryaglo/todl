# TODL Language Server Design

**Goal:** Build a serious LSP-style language service for TODL — a true out-of-process
language server driven by the TODL compiler, delivering the full authoring loop
(diagnostics, completion, hover, go-to-definition, find-references, document symbols,
rename, semantic tokens, folding, workspace symbols, code actions, formatting, signature
help) in Plexus's Monaco editors, with a reusable core and server that an external editor
could later consume.

**Status:** ✅ Finished — all three sub-specs delivered and merged (verified 2026-08-06).
Spec 1 (analysis core, `src/language-service`) and Spec 2 (LSP server,
`src/language-server` + `bin`) are on TODL `main` and shipped in the published
`@pragmatic-lab/todl@0.14.0` (subpath exports `/language-service`, `/language-server`);
64/64 language tests green. Spec 3 (Plexus client) is merged to **Plexus `main`**
(`TodlLanguageClient`, `TodlServerHost`, provider adapters, preload channel), wired at
startup (`main/index.ts` forks the vendored `todl-language-server.cjs` via `child_process` —
`utilityProcess` could not carry an stdio LSP child — and `renderer/main.js` registers the
Monaco providers); Plexus todl tests 22/22 green and the server bundle builds. The **sole
residual is the manual smoke checklist** (`Plexus/docs/superpowers/todl-lsp-smoke-checklist.md`),
which is irreducibly visual and must be run by a human via `npm run dev`. Architecture
approved 2026-07-28. This is the **umbrella design** — the full
picture and the decisions that bind all layers. Implementation is decomposed into three
sequential sub-specs (below); each gets its own detailed spec → plan → build cycle.

---

## Decomposition into specs

The design spans three layers with hard seams (core ← server ← client), each independently
working and testable. It is built as a sequence of sub-specs, each depending only on the
one before:

1. **Spec 1 — Analysis core** (`@pragmatic-lab/todl/language-service`). Parser span-
   enrichment + `analyze()` + the cursor-context classifier + reference index + all pure
   query functions, proven by exhaustive headless unit tests. Delivers standalone,
   verifiable value with no protocol or UI. **The biggest and most valuable slice — brainstorm
   this one next.**

2. **Spec 2 — LSP server** (`@pragmatic-lab/todl/language-server`). Wrap the core in
   `vscode-languageserver`: document sync, capability negotiation, pushed + FS source modes,
   stdio entry point, in-memory protocol integration tests. Depends on Spec 1.

3. **Spec 3 — Plexus client integration** (Plexus main / preload / renderer). `TodlServerHost`
   fork + IPC relay, preload channel, renderer `TodlLanguageClient` (source sync, diagnostics
   routing, hand-rolled Monaco adapters, `WorkspaceEdit` application), model-URI fix, and
   retiring the in-renderer validation pass. Depends on Spec 2.

Spec 1 may itself split at planning time if the capability set makes one plan unwieldy (e.g.
a "foundation" spec — spans + classifier + index + diagnostics/definition/references/hover/
completion — and an "advanced" spec — rename/semantic-tokens/code-actions/formatting/folding/
symbols/signature-help). That call is deferred to when Spec 1's plan is written.

The component sections below remain the authoritative per-layer design; each sub-spec expands
its slice to task-level detail.

---

## Resolved decisions (the forks that shaped this design)

| Fork | Decision |
| --- | --- |
| Engine home | **True out-of-process LSP server** (Node child of Electron main, stdio/LSP), not in-renderer. |
| Spec scope | Whole stack designed together; **built as three sequential sub-specs** (see Decomposition). |
| Capabilities | **Everything** — the full suite below, with a few features honestly flagged as thin. |
| Plexus transport | **Electron main process forks the server** (`utilityProcess`), relays LSP JSON-RPC over IPC. |
| Monaco bridge | **Hand-rolled provider adapters** (one per capability), not `monaco-languageclient`. |
| Source provisioning | **Client pushes sources** (server never reads Plexus's `IStorage`-backed files). |
| Packaging | **Subpath exports of `@pragmatic-lab/todl`** (`/language-service`, `/language-server`), not a monorepo conversion. |

---

## Architecture

### Packaging & layering

Three logical units, realized as two new subpath exports of the existing
`@pragmatic-lab/todl` package plus a Plexus-side consumer:

1. **`@pragmatic-lab/todl/language-service`** *(new source folder in the TODL repo)* — the
   pure analysis core. Depends only on the TODL compiler internals it re-exports. No
   protocol, no Monaco, no I/O. Fully unit-testable headless. **~80% of the intellectual
   work lives here.**

2. **`@pragmatic-lab/todl/language-server`** *(new source folder + a `bin` entry in the
   TODL repo)* — wraps the core in `vscode-languageserver`. Thin protocol shell: capability
   negotiation, document sync, debounced re-analysis, diagnostics push, one delegating
   handler per capability. Ships a stdio entry point.

3. **Plexus client integration** *(Plexus repo — main / preload / renderer)* — forks the
   server from Electron main, relays LSP over IPC, and a renderer `TodlLanguageClient` syncs
   sources + bases, registers the Monaco adapters, and routes diagnostics into the existing
   Problems UI.

**Dependency direction:** core ← server ← Plexus client. Nothing points back. The core
never imports the server; the server never imports Plexus. Directory boundaries + lint
enforce the seam within the single TODL package.

### Why subpath exports rather than a monorepo

TODL is a single-package repo (`@pragmatic-lab/todl` 0.2.0, no workspaces). Subpath exports
give the same layering (enforced by directory boundaries) with one version, one publish, and
no monorepo migration before any LSP work begins. The server subpath declares a `bin` so it
can be spawned as a process; the core subpath is import-only.

---

## Component 1 — The analysis core (`language-service`)

The core exposes `analyze(sources, bases) → Analysis` (parse every file, load the
`Repository`, build a project-wide reference index, memoize) plus a family of **pure query
functions** over an `Analysis`. Each returns plain LSP-shaped data (ranges as
`{ uri, start: {line, column}, end: {line, column} }`), so all of it is unit-testable
without `vscode-languageserver` or Monaco:

`completionsAt` · `hoverAt` · `definitionAt` · `referencesAt` · `documentSymbols` ·
`renameEdits` · `semanticTokens` · `foldingRanges` · `workspaceSymbols` · `codeActions` ·
`formatDocument` · `signatureHelpAt`.

### The central problem: precise positions

Go-to-def, find-references, and rename need exact ranges for *reference* occurrences (a
concept named in `extends`, a field's type, a relationship's `-> target`, an `&ref` value,
an instance's concept). The current parse AST omits spans for most of these:
`FieldDecl`/`RelationshipDecl` carry no spans, and `extends`/`type`/`target` are bare
strings.

**Resolution: enrich the TODL parser with optional reference spans.** Add optional span
fields — `ConceptDecl.extendsSpan?`, `FieldDecl.nameSpan?`/`typeSpan?`,
`RelationshipDecl.nameSpan?`/`targetSpan?`, namespace import spans, instance
`conceptSpan?`/`instanceOfSpan?`, and ref-value spans. Optional keeps it
backward-compatible (mirrors the already-optional `AssignmentNode.span`) and makes the AST
the single source of truth for positions instead of re-tokenizing guesswork. **This parser
enrichment is an explicit early task**, landed in the TODL compiler proper (not the LSP
layer), since the compiler is the right home for source positions.

### Cursor-context classifier

Every position-based query starts here. Given `(uri, line, column)`: find the token under
the cursor (via `tokenize`) and the enclosing AST node, then classify the **role** — type-
reference slot, relationship target, assignment name, `&ref` value, import path, or keyword
slot. The role determines both the candidate set (completion) and how to resolve the symbol
(hover/definition). **One classifier feeds every feature.**

### Reference index

`analyze()` walks each file's enriched AST once and records, per symbol id, every reference
occurrence with its span + role. This backs find-references, rename, and semantic tokens.
It's built alongside the `Repository` load, so it's computed once per analysis, not per
query.

### Per-capability computation (all off `Analysis`)

- **Diagnostics** — `checkAgainst(bases, sources).diagnostics`, unchanged logic, moved
  server-side. Whole project.
- **Semantic tokens** — every identifier classified by *resolved* role (concept / primitive
  / enum / enum-member / relationship / field / instance / unresolved). Replaces the Monarch
  tokenizer's syntactic guess with real semantics.
- **Completion** — role-driven: type slots → concept/primitive/enum names (incl. base
  symbols); `&ref` value → instances/terms *valid for the field's declared target concept*
  (schema-aware — the standout feature, via `schemaOf`/`effectiveSchema` +
  `instancesOf`/`termsOf`); assignment name → the concept's `effectiveSchema` field/
  relationship names; enum value → that enum's cases; top-level → keywords. Items carry
  kind, resolved-type detail, and the target's description as documentation.
- **Hover** — symbol under cursor → kind + signature (a concept with its `extends` +
  members) + description; a reference resolves to its target's info.
- **Definition** — symbol id → `Repository.spanOf(id)` (member keys via
  `Repository.memberKey`), cross-file through `span.uri`.
- **References / rename** — the reference index; rename validates kebab-case + collision and
  returns a project-wide `WorkspaceEdit`. A `prepareRename` validates the range first.
- **Document symbols / folding / workspace symbols** — straight AST / `allNodes` walks.
- **Code actions** — keyed off diagnostic `DiagnosticCode`s: "create missing concept", "add
  import for X", "fix name case", "remove unused import" → each an edit.
- **Formatting** — a **token-based reflow** (indentation, spacing, `;`/brace placement), not
  full AST re-emit, so comments survive. Honest scope: normalization, not opinionated
  restructuring.
- **Signature help** — the thinnest feature: field/relationship type + cardinality shown
  while typing an assignment value. Minimal; flagged low-value (TODL has no call syntax).

### Two honest boundaries

1. **Base symbols** get completion + hover from their `TodlDocument`, but *go-to-definition
   into a base* only works when the base's source is provided — otherwise it's a no-op, since
   compiled bases may lack source spans.
2. **Formatting and code-actions are each substantial** — real tasks, not afterthoughts.

---

## Component 2 — The LSP server (`language-server`)

### Framework & shape

Built on `vscode-languageserver` + `vscode-languageserver-textdocument`. Deliberately thin:
it holds a `TextDocuments` manager + the current base set, and every request handler maps LSP
params → core query → LSP result. No language logic here — it all delegates to
`language-service`. The server owns protocol, sync, and lifecycle only.

### Initialization & capabilities

On `initialize` it advertises exactly what we built: `completionProvider` (trigger
characters `&`, `:`, `-`, space), `hoverProvider`, `definitionProvider`, `referencesProvider`,
`renameProvider` (with `prepareProvider`), `documentSymbolProvider`,
`documentFormattingProvider`, `foldingRangeProvider`, `workspaceSymbolProvider`,
`codeActionProvider`, `signatureHelpProvider`, and `semanticTokensProvider` (with the core's
token-type legend). Incremental text sync (`TextDocumentSyncKind.Incremental`).

### Document model & analysis lifecycle

The `TextDocuments` manager tracks open buffers. On any open/change the server marks the
workspace dirty and debounces (~200 ms) a single `analyze(sources, bases)` over the **whole**
project source set, caches the `Analysis`, then publishes diagnostics for every file.
Read-only queries use the cached `Analysis`; a query arriving mid-edit runs against the
latest cached analysis (stale-tolerant — never blocks the UI). Mirrors today's whole-project
validation, server-side.

### Source provisioning — two modes, one core

- **Pushed mode (Plexus, primary):** the client `didOpen`s every project `.todl` (not just
  the visible tab) so the server has the full source set, and sends a custom `todl/setBases`
  notification carrying the resolved base `TodlDocument`s (JSON). A `todl/refreshBases`
  notification drops + replaces them after a republish (the existing Refresh-Bases action).
  The server never touches disk.
- **FS mode (external, e.g. VS Code later):** standard `workspace/didChangeWatchedFiles` +
  workspace-folder scanning reads `.todl` off disk; bases resolve from the on-disk manifest.
  Same handlers, different source feed. **Built as reuse insurance, only lightly exercised in
  this spec** — Plexus uses pushed mode.

### Entry points

A shared `createServer(connection)` factory both transports call. A `stdio` bin module is
what Electron main forks (and what an external client would spawn). Uses
`vscode-languageserver/node`'s stdio connection.

### Error handling

A core exception during analysis becomes a project-level diagnostic (as the validation
service does today) rather than crashing the connection; the server stays alive. Malformed
source yields parser diagnostics + a partial `Analysis` (degraded but functional queries).

---

## Component 3 — Plexus client integration

Spans all three Plexus layers.

### Main process — server host

A `TodlServerHost` forks the language server as an Electron `utilityProcess` (Node child,
stdio). It's a dumb relay: LSP JSON-RPC from the child's stdout → renderer via an IPC
channel; renderer messages → child's stdin. It owns lifecycle — spawn on first project open;
on child crash, restart and signal the renderer to resync. The server bundle is built as a
separate electron-vite entry and shipped inside the app.

### Preload — the channel

A minimal, typed `todlLsp` bridge on the context-isolated preload: `send(msg)`,
`onMessage(cb)`, `onServerRestart(cb)`. No LSP types leak through preload — it's an opaque
message pipe.

### Renderer — `TodlLanguageClient` service

The center of gravity:

- Builds a `vscode-jsonrpc` `MessageConnection` over the preload pipe (a custom reader/writer
  wrapping `todlLsp`).
- **Source sync:** on project open → resolve bases (`resolveBases`, as today) →
  `todl/setBases`, then `didOpen` every project `.todl` (via `collectTodlSources`). On editor
  edits → incremental `didChange`; on structural changes (new / rename / delete / move) →
  open/close/rename the corresponding server documents; on Refresh-Bases →
  `todl/refreshBases`. This subsumes the diagnostic half of `TodlValidationService`, which is
  refactored into the client's source-feed rather than deleted wholesale.
- **Diagnostics in:** server `publishDiagnostics` → routed into the existing
  `DiagnosticsService` (Problems panel) + the editor's marker channel, reusing the current
  `EditorDiagnostic` / canonical `Diagnostic` mapping so the Problems UI is unchanged.
- **Provider registration:** the hand-rolled adapters (below).
- **WorkspaceEdit application:** rename and quick-fixes return edits spanning multiple files,
  applied **through Plexus's document/storage layer** — open buffers edited in place (dirty
  tracking preserved), closed files edited via storage. The one genuinely fiddly piece; gets
  its own tasks.

### Model URIs — a required fix

Today `CodeEditor` creates anonymous Monaco models, so nothing can map a buffer back to a
file/project. Each editor model must be created with a **stable URI derived from the document
Id** (project-relative path) scoped by project. Everything (providers, diagnostics, edits)
keys on that URI. A small but load-bearing change to `CodeEditor`.

### The bridge — hand-rolled adapters

~12 thin Monaco providers (`registerCompletionItemProvider`, `registerHoverProvider`, …),
each translating Monaco `model + position` → an LSP request over the connection → Monaco
result (~15–25 lines each). Zero new heavy deps, fits the codebase's existing hand-wired
Monaco style (`todl-language.ts` registration, manual markers). The Monaco↔LSP range mapping
functions are pure and unit-tested. `monaco-languageclient` was rejected: its
`@codingame/monaco-vscode-*` service shims version-lock to monaco-editor 0.55 and partially
take over Monaco's service layer, clashing with the bare `monaco.editor.create` setup here —
real integration risk for modest code savings.

---

## Data flow (Plexus, pushed mode)

1. **Project opens** → client resolves bases → `todl/setBases` + `didOpen` for every project
   `.todl` → server `analyze()` → publishes diagnostics → Problems + markers populate.
2. **User edits** → Monaco `onDidChangeModelContent` → client `didChange` → server
   debounced re-`analyze()` → publishes diagnostics → markers update.
3. **User hovers / Ctrl-clicks / Ctrl-Space / renames** → Monaco provider adapter → client
   `sendRequest` → server core query → result → Monaco renders.
4. **Rename / quick-fix** → server returns `WorkspaceEdit` → client applies edits through the
   document/storage layer (unsaved buffers + dirty tracking stay correct).
5. **Server crash** → main restarts the child → renderer resyncs bases + all open documents.

---

## Testing strategy

- **Analysis core** — the real quality gate, fully headless (TODL repo's `tsx --test`).
  Exhaustive unit tests per query function over fixture `.todl` source sets with marked cursor
  positions: completion candidate sets (including the schema-aware `&ref` case), definition /
  references exact ranges cross-file, full rename `WorkspaceEdit`, semantic-token role
  classification, one code-action edit per diagnostic code. The classifier and reference index
  get direct tests.
- **LSP server** — integration tests over an in-memory duplex stream pair: `initialize` →
  `didOpen` → request → assert response; `didChange` → assert re-published diagnostics;
  `todl/setBases` behavior. No child process needed.
- **Plexus client** — unit tests against a **fake** connection: source-sync sequencing
  (open/change/rename/delete → correct notifications), diagnostic routing into
  `DiagnosticsService`, and `WorkspaceEdit` application (open-buffer edit preserves dirty
  state; closed-file edit goes through storage). The pure Monaco↔LSP range mappers are
  unit-tested; the thin adapters need no headless Monaco. `TodlServerHost` relay +
  crash-restart tested with a fake child.
- **Manual smoke** — the irreducibly-visual gate (real Monaco: hover popups, Ctrl-click nav,
  completion widget, rename box, squiggles) stays a user-run `npm run dev` checklist.

---

## Scope boundaries

- **Full-strength (v1):** diagnostics, completion, hover, definition, references, document
  symbols, rename, semantic tokens, folding, workspace symbols.
- **Substantial but in:** code actions / quick-fixes, formatting (token-reflow).
- **Deliberately thin, flagged:** signature help (minimal field/cardinality info); FS-mode
  source provisioning (reuse insurance, lightly exercised); go-to-definition *into* base
  symbols (best-effort, no-op when base source absent).
- **Out of scope (later specs):** the standalone VS Code extension (the stdio entry exists,
  but marketplace packaging + thin client is its own project); incremental/partial
  re-analysis (v1 re-analyzes the whole project per debounce, matching today's validation —
  optimizable later).

---

## Open risks

- **Parser enrichment ripple.** Adding optional spans to the AST must not disturb the loader
  or existing consumers. Mitigation: optional fields only; run the full TODL suite after the
  change.
- **`utilityProcess` packaging.** The forked server bundle must be built and located
  correctly in dev *and* the packaged Electron app. Mitigation: a dedicated electron-vite
  entry + an early end-to-end "server starts and answers `initialize`" smoke.
- **WorkspaceEdit vs. dirty buffers.** Multi-file edits touching open, unsaved documents are
  the subtlest correctness surface. Mitigation: dedicated client tasks + tests distinguishing
  open-buffer vs. closed-file edits.
- **Whole-project re-analysis cost.** Acceptable at current project sizes (matches today's
  validation), but a known future optimization target.
