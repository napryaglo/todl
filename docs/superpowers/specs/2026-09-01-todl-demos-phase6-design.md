# TODL Demos — Phase 6 Design: Monaco + TODL LSP in the browser

**Date:** 2026-09-01
**Status:** Approved design, ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md` (Phase-6 extension; Phases 1–5 DONE and pushed)
**Scope:** Replace the playground's plain Mural `TextBox` with the **Monaco** editor, wired to the **TODL language server running in a Web Worker** — syntax highlighting, live diagnostics (squiggles), hover, and completion, over the real LSP protocol.

## Goal

Give the playground a real code editor with real language intelligence. The editor is **Monaco**; the intelligence comes from the **actual TODL language server** (`createServer`) running in a **Web Worker**, spoken to over LSP (JSON-RPC). Features: Monarch syntax highlighting, `textDocument/publishDiagnostics` → Monaco markers, `textDocument/hover`, `textDocument/completion` (+ semantic tokens if cheap).

## Chosen approach (explicitly the heavier path)

The TODL **language-service core is pure** and already runs client-side, so a main-thread wiring (no worker, no LSP) would deliver the same features with far less code — **this was recommended and declined**. Per the user's choice, Phase 6 runs the **real LSP server in a Web Worker** off the main thread, matching the original roadmap. The cost: TODL-core changes to make the server transport-neutral + browser-safe, a browser worker transport, a Monaco↔LSP client bridge, and Vite bundling of Monaco + a cross-package worker.

## Architecture

```
 Playground (Mural)                         Web Worker
 ┌───────────────────────────┐              ┌──────────────────────────────┐
 │ MonacoEditorHost          │  LSP/JSON-RPC│ createServer(connection)      │
 │  (DomHost → monaco.create) │◀────────────▶│  vscode-languageserver/browser│
 │  Text DP ⇄ editor          │  postMessage │  PushedSourceProvider (no fs) │
 │                           │              │  → analyze()/hoverAt()/…      │
 │ TodlLanguageClient         │              └──────────────────────────────┘
 │  didOpen/didChange ───────▶│
 │  ◀── publishDiagnostics    │  → setModelMarkers
 │  hover/completion providers│  → sendRequest → map LSP↔Monaco
 └───────────────────────────┘
```

- **Editor host:** `MonacoEditorHost extends DomHost` (`@pragmatic-tech-ai/mural/basic`). `DomHost` reserves a rectangle in the Mural SVG tree as a `<foreignObject>` div; the override `CreateHostElement` mounts `monaco.editor.create(div, …)` and wires a two-way, echo-guarded `Text` DP (`onDidChangeModelContent` → DP; DP change → `editor.setValue`). This is exactly Plexus's `CodeEditor` pattern, browser-portable.
- **Worker LSP:** a Vite Web Worker entry builds a browser LSP `Connection` (`vscode-languageserver/browser` `createConnection(BrowserMessageReader(self), BrowserMessageWriter(self))`) and calls `createServer(connection)` (the real TODL server) with `PushedSourceProvider` (text pushed by the client — no filesystem).
- **Client bridge:** `TodlLanguageClient` on the main thread creates a JSON-RPC `MessageConnection` over the Worker (`vscode-jsonrpc/browser`), sends `initialize`/`initialized`, mirrors the editor into the server via `didOpen`/`didChange`, listens for `publishDiagnostics` → `setModelMarkers`, and backs Monaco `HoverProvider`/`CompletionItemProvider` (+ semantic tokens) by `sendRequest` and mapping LSP shapes → Monaco shapes.
- **Monarch grammar:** a pure POJO Monarch grammar for `todl` (ported from Plexus's `todl-grammar.ts`) gives base highlighting; semantic tokens (optional) overlay concept-name coloring.

## TODL-core changes (make the server browser-safe; keep stdio working)

Contained, backward-compatible, and an improvement (transport-neutral server):
1. **Split `src/language-server/workspace.ts`** → move `FsSourceProvider` (the only `node:fs`/`node:url`/`node:path` user) into a new `src/language-server/workspace-fs.ts`. `workspace.ts` keeps `ProjectRegistry`, `PushedSourceProvider`, and `SourceProvider` — **fs-free**.
2. **`src/language-server/server.ts`:** import `TextDocuments, TextDocumentSyncKind, ResponseError, ErrorCodes, type Connection, …` from base **`vscode-languageserver`** (not `/node.js`); drop the unused `createConnection` import and the `FsSourceProvider` import. Add an optional param: `createServer(connection: Connection, makeFsProvider?: () => SourceProvider)`; the `mode === "fs"` branch uses `makeFsProvider?.() ?? new PushedSourceProvider()`.
3. **`src/language-server/stdio.ts`:** `import { FsSourceProvider } from "./workspace-fs.js"`; call `createServer(connection, () => new FsSourceProvider())` — identical stdio behavior.
4. Rebuild `dist`. Existing language-server tests (`stdio.test.ts`, `harness.ts`) stay green; the published package's stdio server is unchanged in behavior.

## App changes

- **Deps:** add `monaco-editor`, `vscode-languageserver` (worker `/browser`), `vscode-jsonrpc` (client `/browser`) to `app/package.json`.
- **Vite:** configure Monaco's editor worker (`MonacoEnvironment.getWorker` → `monaco-editor/esm/vs/editor/editor.worker?worker`); ensure the LSP worker and the app can resolve `@pragmatic-tech-ai/todl/language-server` + `/language-service` (subpath aliases to `dist/…`, mirroring the existing `todl → dist` alias, or make todl a `file:` dep). The LSP worker is created with `new Worker(new URL("./todl-lsp.worker.ts", import.meta.url), { type: "module" })`.
- **New files (`app/src/editor/`):** `monaco-editor-host.ts` (DomHost subclass), `todl-monarch.ts` (grammar + `registerTodlLanguage`), `todl-lsp.worker.ts` (worker entry), `todl-language-client.ts` (client bridge + provider registration), `lsp-monaco.ts` (LSP↔Monaco position/shape mappers).
- **Playground:** replace the editor `TextBox` in `example-runner.mu` with the Monaco host; the host's `Text` binds the existing `Source` DP, so the whole downstream pipeline (compile-stages, graph, chip, permalink) is unchanged. Register the TODL language + start the client once at app init.

## Testing

- **TODL core:** existing language-server tests green after the refactor; add a small unit test that `createServer` works with a fake in-memory connection (initialize → didOpen → a `hover`/`completion` request returns), proving transport-neutrality without stdio.
- **App (browser harness):** Monaco mounts (a `.monaco-editor` DOM node exists under `#app`); typing an erroneous source yields a Monaco marker (`.squiggly-error` or via `monaco.editor.getModelMarkers`); a hover/completion request round-trips through the worker (assert a known completion appears or a hover renders); the existing pipeline still compiles from the edited text. Boot spike (Task 2) asserts the worker answers `initialize`.
- **Green gates:** `npm run test:corpus`, `npm test`, `npm run app:build`.

## Phasing within Phase 6

1. **TODL-core refactor** — transport-neutral, fs-free server (`workspace-fs` split + `createServer` param + base import); rebuild dist; tests green + a transport-neutral unit test.
2. **Boot spike** — add deps + Vite Monaco/worker config; `MonacoEditorHost` mounts an empty Monaco in the app; a trivial `todl-lsp.worker.ts` answers `initialize`. Prove the whole stack bundles + boots before deeper wiring.
3. **Monarch highlighting** — `todl-monarch.ts` grammar + register; verify tokens colorize.
4. **Diagnostics** — client `didOpen`/`didChange` + `publishDiagnostics` → `setModelMarkers`; verify a bad source squiggles.
5. **Hover + completion (+ semantic tokens)** — register Monaco providers over LSP requests; verify a hover + a completion.
6. **Playground wiring** — swap the `TextBox` for the Monaco host bound to `Source`; confirm the downstream pipeline + earlier features (graph/chip/permalink) still work.
7. **Docs + spec status + full green pass.**

## Open risks / notes

- **Bundling the LSP worker** — the worker imports `@pragmatic-tech-ai/todl/language-server` (→ dist) + `vscode-languageserver/browser`. Vite must resolve the cross-package subpath inside the worker (alias or `file:` dep) and tree-shake node paths (guaranteed by the fs-free refactor). De-risked in Task 2.
- **Monaco worker in Vite** — needs `MonacoEnvironment.getWorker`; only the editor worker is required (custom language, no built-in language workers). Bundle size grows substantially — acceptable for a demo; note it.
- **DomHost sizing/focus** — Monaco must resize with its `foreignObject` and not fight Mural's focus/event routing; Plexus stops key/pointer events at the host boundary — replicate. Verify caret + typing work.
- **Two `Text`/`Source` owners** — the Monaco host's `Text` and the runner's `Source` must stay in sync without an echo loop (guard with an `updating` flag, per Plexus).
- **LSP client interop** — worker uses `vscode-languageserver/browser` (built on `vscode-jsonrpc`); client uses `vscode-jsonrpc/browser` directly. Both speak JSON-RPC; hand-shape LSP params (method strings + `{textDocument:{uri}, position}`) to avoid pulling in a heavy client lib.
- **Scope** — go-to-definition/references/rename/formatting are available server-side but out of scope for a single-file playground; highlighting + diagnostics + hover + completion (+ semantic tokens) are the target.
