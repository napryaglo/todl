# TODL Demos — Phase 6 Implementation Plan (Monaco + TODL LSP in a Web Worker)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the playground's Mural `TextBox` with the Monaco editor, wired to the real TODL language server running in a Web Worker over LSP — Monarch highlighting, live diagnostics, hover, completion (+ semantic tokens).

**Architecture:** `MonacoEditorHost extends DomHost` mounts Monaco into the Mural SVG tree (`<foreignObject>`), with a two-way echo-guarded `Text` DP bound to the existing `Source`. A Vite Web Worker runs the unchanged `createServer` (browser transport + `PushedSourceProvider`). A main-thread `TodlLanguageClient` speaks JSON-RPC to the worker: mirrors the editor via `didOpen`/`didChange`, turns `publishDiagnostics` into markers, and backs Monaco hover/completion providers. Small TODL-core changes make the server transport-neutral + fs-free.

**Tech Stack:** `monaco-editor`; `vscode-languageserver/browser` (worker); `vscode-jsonrpc/browser` (client); `@pragmatic-tech-ai/todl/language-server` (`createServer`) + `/language-service` (pure `analyze`/`hoverAt`/`completionsAt`/`semanticTokens`); Mural `DomHost` (`/basic`); Vite worker + Monaco worker config; Playwright + system Edge.

**Spec:** `docs/superpowers/specs/2026-09-01-todl-demos-phase6-design.md`

## Global Constraints

- **Keep stdio working.** The TODL-core refactor is backward-compatible: `stdio.ts` behavior and the published server are unchanged. Existing language-server tests stay green.
- **Server must be browser-safe.** After Task 1, importing `createServer` pulls in NO `node:fs`/`node:path`/`node:url` and NO `vscode-languageserver/node.js`. Enforced by the fs-free `workspace.ts` + base-package import.
- **One source of truth for text.** Monaco `Text` ⇄ `Source` sync is echo-guarded (an `updating` flag); never loop.
- **Downstream pipeline unchanged.** The Monaco host feeds the existing `Source` DP; compile-stages, graph, vs-golden chip, permalink keep working off `Source`.
- **`app/` stays out of the published package.** New deps are app-local; `dist` boundary unaffected.
- **Rebuild dist after Task 1** (`npm run build`) so the app's `../dist` alias sees the refactored server; `npm run app:build` chains it.
- **UI verification** reuses the committed harness plus small bespoke Playwright scripts (Monaco/marker assertions need DOM/`monaco` queries, not just SVG text). System Edge (`channel:"msedge"`).

## File Structure

```
src/language-server/
  workspace.ts        # MODIFY: remove FsSourceProvider (+ node imports) → fs-free
  workspace-fs.ts     # NEW: FsSourceProvider (node:fs/url/path lives here)
  server.ts           # MODIFY: base vscode-languageserver import; createServer(conn, makeFsProvider?)
  stdio.ts            # MODIFY: inject () => new FsSourceProvider()
  tests/server-transport.test.ts  # NEW: createServer over an in-memory connection
app/
  package.json        # MODIFY: + monaco-editor, vscode-languageserver, vscode-jsonrpc
  vite.config.ts      # MODIFY: Monaco worker env note + todl subpath aliases
  src/editor/
    todl-monarch.ts        # NEW: Monarch grammar + registerTodlLanguage()
    monaco-editor-host.ts  # NEW: DomHost subclass mounting Monaco (+ Text DP)
    todl-lsp.worker.ts     # NEW: Web Worker — browser connection + createServer
    todl-language-client.ts# NEW: client bridge (didOpen/didChange, diagnostics, providers)
    lsp-monaco.ts          # NEW: LSP↔Monaco position/shape mappers
    monaco-setup.ts        # NEW: MonacoEnvironment.getWorker wiring
  src/components/example-runner/example-runner.mu  # MODIFY: editor pane → Monaco host
  src/main.ts         # MODIFY: register language + start client at init
  README.md           # MODIFY: document the Monaco/LSP editor
docs/superpowers/specs/2026-09-01-todl-demos-app-design.md  # MODIFY: note Phase 6
```

---

## Task 1: TODL-core — transport-neutral, fs-free server

**Files:** New `src/language-server/workspace-fs.ts`; Modify `workspace.ts`, `server.ts`, `stdio.ts`; New `src/language-server/tests/server-transport.test.ts`.

- [ ] **Step 1: Extract `FsSourceProvider`.** Create `src/language-server/workspace-fs.ts` containing the `FsSourceProvider` class **verbatim** (move it out of `workspace.ts`), keeping `import { readdirSync, readFileSync } from "node:fs"`, `node:url`, `node:path` and whatever helpers (`walkTodl`) it uses. Add `import { ProjectRegistry, PushedSourceProvider, type SourceProvider } from "./workspace.js";` if it references them. Export `FsSourceProvider`.

- [ ] **Step 2: Make `workspace.ts` fs-free.** Remove the `FsSourceProvider` class and the now-unused `node:fs`/`node:url`/`node:path` imports (and any helper only it used). Keep `ProjectRegistry`, `PushedSourceProvider`, `SourceProvider`. `workspace.ts` must have zero `node:` imports.

- [ ] **Step 3: Update `server.ts`.**
  - Change the transport import to base package and drop `createConnection`:
    ```ts
    import {
      TextDocuments, TextDocumentSyncKind, ResponseError, ErrorCodes,
      type Connection, type InitializeParams, type InitializeResult,
    } from "vscode-languageserver";
    ```
  - Change the workspace import to drop `FsSourceProvider`:
    ```ts
    import { ProjectRegistry, PushedSourceProvider, type SourceProvider } from "./workspace.js";
    ```
  - Signature + fs branch:
    ```ts
    export function createServer(connection: Connection, makeFsProvider?: () => SourceProvider): void {
    // …
      provider = mode === "fs" ? (makeFsProvider?.() ?? new PushedSourceProvider()) : new PushedSourceProvider();
    ```

- [ ] **Step 4: Update `stdio.ts`** to inject the fs provider:
  ```ts
  import { FsSourceProvider } from "./workspace-fs.js";
  // …
  createServer(connection, () => new FsSourceProvider());
  ```
  (`createConnection` stays imported here from `vscode-languageserver/node.js`.)

- [ ] **Step 5: Transport-neutral unit test** `src/language-server/tests/server-transport.test.ts` — prove `createServer` works over a non-stdio connection. Use the existing test harness if it already builds an in-memory connection; otherwise create a minimal pair with `vscode-languageserver-protocol` / `vscode-jsonrpc` in-memory streams. Minimal shape:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
// Build an in-memory duplex connection (reuse harness.ts if it exposes one).
// Initialize (pushed mode), didOpen a source, request hover → expect a result or null without throwing.
test("createServer initializes and answers over an in-memory connection (no stdio, no fs)", async () => {
  // … wire connection, createServer(connection), connection.listen();
  // send initialize {} → expect capabilities.hoverProvider === true
});
```
> If `tests/harness.ts` already spins up the server over an in-memory transport (it powers `stdio.test.ts`), reuse it — this test then just asserts a hover/completion round-trips in pushed mode with no `workspaceFolders`.

- [ ] **Step 6: Verify + rebuild.**
  - `npm test` (all `src/**` incl. language-server) → green.
  - `grep -rE "node:" src/language-server/workspace.ts` → no matches; `grep "node.js" src/language-server/server.ts` → no matches.
  - `npm run build` → dist refreshed.

- [ ] **Step 7: Commit** `refactor(todl): transport-neutral, fs-free language server (browser-ready)`.

---

## Task 2: Boot spike — Monaco via DomHost + worker `initialize`

Prove the whole stack bundles and boots before deeper wiring: Monaco mounts in the app, and a Web Worker running `createServer` answers `initialize`.

**Files:** Modify `app/package.json`, `app/vite.config.ts`; New `app/src/editor/{monaco-setup.ts, monaco-editor-host.ts, todl-lsp.worker.ts}`; temporary wiring in `main.ts`.

- [ ] **Step 1: Add deps + install.** In `app/package.json` dependencies: `"monaco-editor": "^0.52.0"`, `"vscode-languageserver": "^9.0.1"`, `"vscode-jsonrpc": "^8.2.0"`. `cd app && npm install`.

- [ ] **Step 2: Vite resolution.** In `app/vite.config.ts`, add aliases so the worker resolves the todl subpaths from dist (mirror the existing `@pragmatic-tech-ai/todl → dist/index.js`):
  ```ts
  { find: /^@pragmatic-tech-ai\/todl\/language-server$/, replacement: resolve(repoRoot, "dist/language-server/index.js") },
  { find: /^@pragmatic-tech-ai\/todl\/language-service$/, replacement: resolve(repoRoot, "dist/language-service/index.js") },
  ```
  (Keep the existing exact `@pragmatic-tech-ai/todl` alias — order the subpath regexes before it.)

- [ ] **Step 3: Monaco worker env** `app/src/editor/monaco-setup.ts`:
  ```ts
  import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
  // Custom language only — the base editor worker is all Monaco needs.
  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() };
  ```

- [ ] **Step 4: `MonacoEditorHost`** `app/src/editor/monaco-editor-host.ts` — a `DomHost` that mounts Monaco:
  ```ts
  import "./monaco-setup.js";
  import * as monaco from "monaco-editor";
  import { DomHost } from "@pragmatic-tech-ai/mural/basic";
  import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";

  export class MonacoEditorHost extends DomHost {
    static TextKey = MuralBase.RegisterProperty<string>(MonacoEditorHost, "Text", "", MetaData.None);
    get Text(): string { return this.get_property_value(MonacoEditorHost.TextKey); }
    set Text(v: string) { this.set_property_value(MonacoEditorHost.TextKey, v); }
    private editor?: monaco.editor.IStandaloneCodeEditor;
    private updating = false;

    protected override CreateHostElement(document: Document): HTMLElement {
      const el = super.CreateHostElement(document);
      el.style.overflow = "hidden";
      this.editor = monaco.editor.create(el, { value: this.Text, language: "todl", automaticLayout: true, minimap: { enabled: false }, fontSize: 13 });
      this.editor.onDidChangeModelContent(() => {
        this.updating = true; this.set_property_value(MonacoEditorHost.TextKey, this.editor!.getValue()); this.updating = false;
      });
      // Keep Monaco's own key/pointer handling from fighting Mural's routing.
      for (const ev of ["keydown","keyup","pointerdown","pointerup"]) el.addEventListener(ev, (e) => e.stopPropagation());
      return el;
    }
    protected override OnPropertyChanged(key: unknown, oldV: unknown, newV: unknown): void {
      super.OnPropertyChanged?.(key as never, oldV as never, newV as never);
      if (key === MonacoEditorHost.TextKey && this.editor && !this.updating && newV !== this.editor.getValue()) {
        this.editor.setValue(String(newV ?? ""));
      }
    }
  }
  ```
  > `DomHost`'s exact property-changed hook name/signature is verified in-code during this task (the spike surfaces it); adjust `OnPropertyChanged` to the real virtual if named differently. `super.CreateHostElement` returns the sized container div.

- [ ] **Step 5: Trivial worker** `app/src/editor/todl-lsp.worker.ts`:
  ```ts
  import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";
  import { createServer } from "@pragmatic-tech-ai/todl/language-server";
  const connection = createConnection(new BrowserMessageReader(self as never), new BrowserMessageWriter(self as never));
  createServer(connection);
  connection.listen();
  ```

- [ ] **Step 6: Temp boot wiring in `main.ts`** — register a stub `todl` language (so Monaco doesn't warn) and mount a `MonacoEditorHost` as the app root (temporarily), and spin the worker asserting `initialize`:
  ```ts
  import * as monaco from "monaco-editor";
  monaco.languages.register({ id: "todl" });
  // TEMP: host a MonacoEditorHost to prove it renders; and:
  const worker = new Worker(new URL("./editor/todl-lsp.worker.ts", import.meta.url), { type: "module" });
  import { BrowserMessageReader, BrowserMessageWriter } from "vscode-jsonrpc/browser";
  import { createMessageConnection } from "vscode-jsonrpc";
  const conn = createMessageConnection(new BrowserMessageReader(worker), new BrowserMessageWriter(worker));
  conn.listen();
  conn.sendRequest("initialize", { processId: null, rootUri: null, capabilities: {} }).then((r) => console.log("[lsp] initialized", r));
  ```
  (This is throwaway wiring to prove boot; Task 6 replaces it with real playground wiring.)

- [ ] **Step 7: Build + verify boot.** `cd app && npx vite build` → succeeds (Monaco + worker bundle). Preview; a bespoke Playwright script asserts: (a) `document.querySelector("#app .monaco-editor")` exists (Monaco mounted in the foreignObject), (b) the page console logged `[lsp] initialized` with `capabilities.hoverProvider` (worker answered over the browser transport), (c) no `pageerror`. If bundling fails (subpath/worker resolution), fix aliases/worker config here — this is the de-risk gate.

- [ ] **Step 8: Commit** `feat(demos): boot spike — Monaco (DomHost) + Web Worker LSP initialize`.

---

## Task 3: Monarch syntax highlighting

**Files:** New `app/src/editor/todl-monarch.ts`; Modify `app/src/main.ts`.

- [ ] **Step 1: Grammar + registration** `todl-monarch.ts` — port Plexus's pure Monarch grammar (`Plexus/src/renderer/src/modules/meta-model/todl-grammar.ts`) as a POJO `todlMonarchLanguage` (keywords `namespace concept model primitive taxonomy enum annotation package operator import uses class instanceof extends`, operators `/[-~=<>!]{2,}/`, `//` + block comments, `"`/`"""` strings, `:`/`?`/`[]`/`[+]` punctuation), plus a `todlLanguageConfiguration` (comments, brackets, autoClosingPairs). Export `registerTodlLanguage()`:
  ```ts
  export function registerTodlLanguage(): void {
    monaco.languages.register({ id: "todl" });
    monaco.languages.setMonarchTokensProvider("todl", todlMonarchLanguage);
    monaco.languages.setLanguageConfiguration("todl", todlLanguageConfiguration);
  }
  ```

- [ ] **Step 2: Call it** in `main.ts` (replace the Task-2 stub `monaco.languages.register`).

- [ ] **Step 3: Verify.** Build; a Playwright script sets the editor text to a known source and asserts colorized tokens exist — e.g. `#app .monaco-editor .mtk` spans with more than one distinct `class` (keywords vs identifiers get different `mtkN` classes). No `pageerror`.

- [ ] **Step 4: Commit** `feat(demos): TODL Monarch syntax highlighting in Monaco`.

---

## Task 4: Live diagnostics (client bridge → markers)

**Files:** New `app/src/editor/{todl-language-client.ts, lsp-monaco.ts}`; Modify `main.ts`.

- [ ] **Step 1: LSP↔Monaco mappers** `lsp-monaco.ts` — `toMonacoRange(lspRange)`, `toLspPosition(monacoPosition)` (LSP is 0-based line/char; Monaco is 1-based line/column), and `toMarker(lspDiagnostic)` → `monaco.editor.IMarkerData` (severity map Error/Warning/Info/Hint).

- [ ] **Step 2: `TodlLanguageClient`** `todl-language-client.ts` — owns the worker + connection and the open model:
  ```ts
  export class TodlLanguageClient {
    private conn; private version = 0; readonly uri = "inmemory://playground.todl";
    constructor() { /* new Worker(...); createMessageConnection(...); conn.listen(); */ }
    async start(): Promise<void> {
      await this.conn.sendRequest("initialize", { processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: "pushed" } });
      this.conn.sendNotification("initialized", {});
      this.conn.onNotification("textDocument/publishDiagnostics", (p) => this.onDiagnostics(p));
    }
    openOrUpdate(text: string): void {
      const method = this.version === 0 ? "textDocument/didOpen" : "textDocument/didChange";
      const params = this.version === 0
        ? { textDocument: { uri: this.uri, languageId: "todl", version: ++this.version, text } }
        : { textDocument: { uri: this.uri, version: ++this.version }, contentChanges: [{ text }] };
      this.conn.sendNotification(method, params);
    }
    request(method, position?) { /* sendRequest(method, {textDocument:{uri}, position}) */ }
    private onDiagnostics(p) { /* set markers on the model for p.uri */ }
  }
  ```
  On `publishDiagnostics`, `monaco.editor.setModelMarkers(model, "todl", p.diagnostics.map(toMarker))` where `model = monaco.editor.getModel(monaco.Uri.parse(this.uri))`.

- [ ] **Step 3: Wire the model URI.** The `MonacoEditorHost` must create its model with the client's URI so markers land on it: pass the uri into the host (or have the host use `monaco.editor.createModel(text, "todl", monaco.Uri.parse(uri))`). Push text on every `Text` change (debounced ~250ms) via `client.openOrUpdate(text)`.

- [ ] **Step 4: Verify.** Build; Playwright: type an erroneous source (`namespace app { concept C { label : string; } model M : app { C c { } } }` — required-missing), wait, assert `monaco.editor.getModelMarkers({}).length > 0` with a matching message. Type a clean source → markers clear. No `pageerror`.

- [ ] **Step 5: Commit** `feat(demos): live LSP diagnostics → Monaco markers`.

---

## Task 5: Hover + completion (+ semantic tokens)

**Files:** Modify `todl-language-client.ts` (register providers), `lsp-monaco.ts` (hover/completion mappers), `main.ts`.

- [ ] **Step 1: Providers** — register on the `todl` language, delegating to LSP requests:
  ```ts
  monaco.languages.registerHoverProvider("todl", { provideHover: async (model, pos) => {
    const h = await client.request("textDocument/hover", toLspPosition(pos));
    return h ? { contents: [{ value: hoverText(h) }], range: h.range && toMonacoRange(h.range) } : null;
  }});
  monaco.languages.registerCompletionItemProvider("todl", {
    triggerCharacters: ["&", ":", "-", " "],
    provideCompletionItems: async (model, pos) => {
      const items = await client.request("textDocument/completion", toLspPosition(pos));
      return { suggestions: (Array.isArray(items) ? items : items?.items ?? []).map((it) => toMonacoCompletion(it, pos)) };
    },
  });
  ```
  `toMonacoCompletion` maps `label`/`kind`/`detail`/`insertText`; `hoverText` extracts the LSP hover `contents` markdown/string.

- [ ] **Step 2 (optional, if cheap): semantic tokens** — `registerDocumentSemanticTokensProvider("todl", { getLegend: () => LEGEND, provideDocumentSemanticTokens: async () => ({ data: new Uint32Array(await client.request("textDocument/semanticTokens/full", undefined).then(r => r?.data ?? [])) }), releaseDocumentSemanticTokens() {} })` with `LEGEND` mirroring the server's `SEMANTIC_LEGEND`. Skip if it complicates; highlighting/diagnostics/hover/completion are the core.

- [ ] **Step 3: Verify.** Build; Playwright: place the cursor on a concept name and trigger hover (`monaco` API or hover over the token) → assert a hover tooltip text appears; trigger completion (Ctrl+Space via `page.keyboard`) → assert the suggest widget lists a known keyword/type. No `pageerror`. (Hover/completion assertions are best-effort against Monaco's DOM widgets; if fiddly, assert the client `request` resolves a non-empty LSP result via a page hook.)

- [ ] **Step 4: Commit** `feat(demos): LSP hover + completion in Monaco`.

---

## Task 6: Playground wiring (swap the editor)

**Files:** Modify `app/src/components/example-runner/example-runner.mu`, possibly `example-runner-vm.ts`, `app/src/main.ts`, `app/src/pages/playground/*`.

- [ ] **Step 1: Host the Monaco editor.** Replace the editor `TextBox` in `example-runner.mu`'s left cell with the `MonacoEditorHost`, binding its `Text` to `$Source` (two-way). If a VM-owned host instance is simpler than a `.mu` element (given DomHost + model URI wiring), expose an `Editor` DP on `ExampleRunnerVM` holding a configured `MonacoEditorHost` and host it via `ContentControl [ Content = $Editor ]`. Ensure read-only docs usage (`Editable=false`) sets Monaco `readOnly`.

- [ ] **Step 2: Single client, single model.** Start one `TodlLanguageClient` at app init (`main.ts`), create the editor model with the client's URI, and push text on edits. The client's diagnostics land on that model; the existing `Source`-driven pipeline (compile-stages, graph, chip, permalink) is unchanged because the host mirrors `Text` → `Source`.

- [ ] **Step 3: Verify end-to-end.** Build; Playwright: (a) Monaco shows the seeded example source; (b) editing updates the JSON/graph tabs (the pipeline still runs off `Source`); (c) an error shows both a Monaco squiggle AND the Diagnostics tab; (d) permalink + vs-golden chip still work. No `pageerror`. Also re-run a prior harness check (gallery/docs pages) to confirm no regression.

- [ ] **Step 4: Commit** `feat(demos): playground uses the Monaco/LSP editor`.

---

## Task 7: Docs, spec status & full green pass

**Files:** Modify `app/README.md`, parent spec.

- [ ] **Step 1: `app/README.md`** — document the Monaco editor + Web Worker LSP (highlighting/diagnostics/hover/completion), the `DomHost` mount, and the worker/client split; note the added deps + Monaco worker config.
- [ ] **Step 2: Parent spec** — append a Phase 6 line under "Phasing" marked DONE.
- [ ] **Step 3: Full green** — `npm run test:corpus`, `npm test`, `npm run app:build` all clean. Confirm `npm pack --dry-run` still ships only `dist/**` + README (new `workspace-fs.js` is under `dist/`, which is fine; app deps are app-local).
- [ ] **Step 4: Commit** `docs(demos): document the Monaco/LSP editor; note Phase 6`.

---

## Self-Review

**Spec coverage:** transport-neutral server → Task 1; Monaco mount + worker boot → Task 2; highlighting → Task 3; diagnostics → Task 4; hover/completion (+semantic) → Task 5; playground swap → Task 6; docs → Task 7. ✓
**Placeholder scan:** the client-bridge/provider bodies are sketched with real method strings + shapes; a few Mural/Monaco API exacts (DomHost's property-changed virtual, DomHost sizing) are explicitly resolved during Task 2/4 against the real types, not left vague. No TBD requirements.
**Type consistency:** `MonacoEditorHost.Text` ⇄ `Source`; `TodlLanguageClient` (worker+conn+uri) used by providers (Task 5) and the host (Task 4/6); `createServer(connection, makeFsProvider?)` (Task 1) consumed by `stdio.ts` and the worker (Task 2, no factory → pushed mode); `lsp-monaco` mappers shared by diagnostics/hover/completion.

**Open risks (verify during execution — Task 2 is the gate):**
1. **Cross-package worker bundling** — the worker imports `@pragmatic-tech-ai/todl/language-server` (→ dist) + `vscode-languageserver/browser`. If Vite can't resolve the subpath in the worker, add the subpath aliases (Task 2 Step 2) or make todl a `file:` dep. Node code must be absent (guaranteed by Task 1). **Gate in Task 2 Step 7.**
2. **DomHost API exacts** — the property-changed virtual name/signature and the sized-container contract are confirmed against `Mural/src/basic/dom-host.ts` during Task 2; adjust `MonacoEditorHost` to the real hooks.
3. **Monaco worker in Vite** — `?worker` import + `MonacoEnvironment.getWorker`; if the base worker is insufficient, Monaco logs a missing-worker warning — add it. Bundle size grows a lot; acceptable, noted.
4. **JSON-RPC interop** — worker (`vscode-languageserver/browser`) ↔ client (`vscode-jsonrpc/browser`) both speak JSON-RPC; if `initialize` hangs, check both `.listen()` are called and the reader/writer are bound to the same `Worker`/`self`. Verified by the Task 2 `initialize` round-trip.
5. **Text echo loop** — the `updating` guard must fully break Monaco↔`Text`↔`Source`↔`didChange` cycles; verify typing doesn't re-enter (Task 4/6).
6. **Focus/caret in a foreignObject** — Monaco caret + selection must work inside the Mural SVG; the event-stop-at-boundary (Task 2 Step 4) mirrors Plexus. Verify typing/caret in Task 2.
