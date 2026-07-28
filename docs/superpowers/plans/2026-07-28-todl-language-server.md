# TODL LSP Server Implementation Plan (Spec 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the completed analysis core in a `vscode-languageserver` LSP server — one process that partitions documents into multiple projects (pushed + FS source modes), keeps each project's analysis fresh, answers every LSP request by delegating to the core, and ships a stdio binary.

**Architecture:** A new `src/language-server/` folder exported as `@pragmatic-lab/todl/language-server` (with a `bin`). A `ProjectRegistry` assigns documents to projects by longest URI-prefix match; a `SourceProvider` supplies each project's sources (open-buffer text for pushed mode, on-disk `*.todl` for FS mode). `createServer(connection)` wires capabilities, thin delegating request handlers, custom base notifications, and a debounced per-project re-analysis loop.

**Tech Stack:** TypeScript (ESM, strict: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), `@pragmatic-lab/todl/language-service` (the core), `vscode-languageserver@9` + `vscode-languageserver-textdocument`, `vscode-jsonrpc` (test harness), `node:test` via `tsx`.

**Spec:** [`2026-07-28-todl-language-server-spec2-design.md`](../specs/2026-07-28-todl-language-server-spec2-design.md).

## Global Constraints

- **Thin server:** no language logic; every request handler maps LSP params → a core query over the owning project's cached `Analysis` → an LSP result.
- **Dependency direction:** server → core → compiler. The server imports the core's public barrel (`@pragmatic-lab/todl/language-service`), never its internals.
- **Multi-project:** documents assigned to projects by **longest-prefix match** of URI against registered `rootUri`s. Re-analysis is per project; editing project A never re-analyzes project B.
- **FS-mode bases:** FS mode validates each workspace as a self-contained project (`bases = []`); it resolves no external published meta-models. External bases are pushed-mode only.
- **Strict mode:** guard indexed access; never assign `undefined` to an optional property — omit or guard.
- **Tests:** `tests/` subfolder next to source. Run `npx tsx --conditions=development --test "<glob>"`.
- **Install note:** `vscode-languageserver` / `vscode-languageserver-textdocument` install from public npm (Verdaccio down) with `--no-save`; the lockfile reconciles on the next registry-up install.

**Existing core surface this plan consumes** (all from `@pragmatic-lab/todl/language-service`):
`analyze(sources: SourceFile[], bases?: TodlDocument[]): Analysis`; `Analysis { sources: Map<uri,{ast,tokens,text}>, model, refs, defs, diagnostics: Diagnostic[] }`; and the query fns `completionsAt`, `hoverAt`, `definitionAt`, `referencesAt`, `prepareRename`, `renameEdits` (→ `WorkspaceEdit | {error}`), `documentSymbols`, `foldingRanges`, `workspaceSymbols`, `semanticTokens`, `SEMANTIC_LEGEND`, `codeActions`, `formatDocument`, `signatureHelpAt`. `SourceFile` = `{ uri: string; text: string }` (from `@pragmatic-lab/todl`); `TodlDocument` (from `@pragmatic-lab/todl`).

---

### Task 1: Package wiring + barrel

Add the LSP runtime deps, the `@pragmatic-lab/todl/language-server` subpath export, the `bin` field, and a barrel that re-exports `createServer` (added in Task 5). Task 1 lands the barrel importing a placeholder so the package resolves; `createServer` arrives in Task 5.

**Files:**
- Modify: `package.json` (deps, `exports`, `bin`)
- Create: `src/language-server/index.ts`
- Test: `src/language-server/tests/package.test.ts`

**Interfaces:**
- Produces: the subpath `@pragmatic-lab/todl/language-server` resolving to `src/language-server/index.ts` (dev condition).

- [ ] **Step 1: Install the runtime deps**

Run: `npm install vscode-languageserver@^9 vscode-languageserver-textdocument@^1.0.12 --registry=https://registry.npmjs.org --no-save`
Expected: both present under `node_modules/`.

- [ ] **Step 2: Add deps + export + bin to `package.json`**

Add to `dependencies`:

```json
"vscode-languageserver": "^9.0.1",
"vscode-languageserver-textdocument": "^1.0.12"
```

Add to `exports` (beside `./language-service`):

```json
"./language-server": {
  "types": "./dist/language-server/index.d.ts",
  "import": {
    "development": "./src/language-server/index.ts",
    "default": "./dist/language-server/index.js"
  }
}
```

Add a top-level `bin`:

```json
"bin": { "todl-language-server": "./dist/language-server/stdio.js" }
```

- [ ] **Step 3: Create the barrel `src/language-server/index.ts`**

```ts
// Public surface of the TODL language server. createServer is added in the
// server task; re-exported here so consumers import a single module.
export { createServer } from "./server.js";
```

> Until Task 5 creates `server.ts`, this import is unresolved. Task 1's test only checks the package's `language-service` sibling still resolves; the `language-server` barrel is exercised from Task 5 on. To keep Task 1 green on its own, temporarily stub `server.ts` in this task (replaced in Task 5):
>
> Create `src/language-server/server.ts`:
> ```ts
> // Placeholder — replaced in the server task.
> export function createServer(_connection: unknown): void { /* wired in Task 5 */ }
> ```

- [ ] **Step 4: Write the resolution test**

Create `src/language-server/tests/package.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../index.js";

test("the language-server barrel exports createServer", () => {
  assert.equal(typeof createServer, "function");
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-server/tests/package.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/language-server/index.ts src/language-server/server.ts src/language-server/tests/package.test.ts
git commit -m "chore(language-server): package wiring + barrel"
```

---

### Task 2: Core enhancement — diagnostics grouped by URI

An LSP server publishes diagnostics per document URI, but `Analysis.diagnostics` is a flat list (the mapping dropped each diagnostic's file). Add `Analysis.diagnosticsByUri`: LSP diagnostics grouped by originating file, with every source file present (so a fixed file's squiggles clear) and whole-model (null-span) diagnostics attached to every file in the project.

**Files:**
- Modify: `src/language-service/analysis.ts`
- Test: `src/language-service/tests/analysis.test.ts` (extend)

**Interfaces:**
- Consumes: `mapDiagnostic` (already in `./diagnostics.js`); the TODL `Diagnostic` from `checkAgainst` (carries `span.uri`).
- Produces: `Analysis.diagnosticsByUri: Map<string, Diagnostic[]>`.

- [ ] **Step 1: Write the failing test (extend the analysis suite)**

Append to `src/language-service/tests/analysis.test.ts`:

```ts
test("diagnosticsByUri groups diagnostics per file and lists every source", () => {
  const a = analyze([
    { uri: "a.todl", text: "namespace demo {\n  primitive string { }\n  concept person { name : string; }\n  person alice { }\n}" },
    { uri: "b.todl", text: "namespace other {\n  concept clean { }\n}" },
  ]);
  // Every source file has an entry (empty for the clean one).
  assert.ok(a.diagnosticsByUri.has("a.todl"));
  assert.ok(a.diagnosticsByUri.has("b.todl"));
  assert.equal(a.diagnosticsByUri.get("b.todl")!.length, 0);
  // The required-missing diagnostic is attributed to a.todl.
  assert.ok(a.diagnosticsByUri.get("a.todl")!.length >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/analysis.test.ts"`
Expected: FAIL — `diagnosticsByUri` is undefined.

- [ ] **Step 3: Implement in `src/language-service/analysis.ts`**

Add the import and field, and build the map in `analyze`:

```ts
import { mapDiagnostics, mapDiagnostic } from "./diagnostics.js";
```

Add to the `Analysis` interface:

```ts
  diagnosticsByUri: Map<string, Diagnostic[]>;
```

In `analyze`, after `const { model, diagnostics } = checkAgainst(bases, sources);`, build the grouping and include it in the returned object:

```ts
  const byUri = new Map<string, Diagnostic[]>();
  for (const src of sources) byUri.set(src.uri, []);
  const wholeModel: Diagnostic[] = [];
  for (const d of diagnostics) {
    const lsp = mapDiagnostic(d);
    const uri = d.span?.uri ?? null;
    if (uri === null) { wholeModel.push(lsp); continue; }
    const list = byUri.get(uri);
    if (list === undefined) byUri.set(uri, [lsp]);
    else list.push(lsp);
  }
  // Whole-model diagnostics (no file) surface on every file in the project.
  if (wholeModel.length > 0) for (const list of byUri.values()) list.push(...wholeModel);
```

and add `diagnosticsByUri: byUri,` to the returned object (keep the existing flat `diagnostics: mapDiagnostics(diagnostics)`).

- [ ] **Step 4: Run the analysis suite + full suite**

Run: `npx tsx --conditions=development --test "src/language-service/tests/analysis.test.ts"`
Expected: PASS. Then `npm test` — the whole repo still green (additive field).

- [ ] **Step 5: Commit**

```bash
git add src/language-service/analysis.ts src/language-service/tests/analysis.test.ts
git commit -m "feat(language-service): diagnosticsByUri on Analysis for per-file publishing"
```

---

### Task 3: ProjectRegistry

The multi-project store: register roots, assign documents by longest-prefix match, hold each project's bases + cached analysis + dirty flag.

**Files:**
- Create: `src/language-server/workspace.ts`
- Test: `src/language-server/tests/workspace.test.ts`

**Interfaces:**
- Consumes: `Analysis` from `@pragmatic-lab/todl/language-service`; `TodlDocument` from `@pragmatic-lab/todl`.
- Produces:
  - `interface Project { rootUri: string; bases: TodlDocument[]; analysis: Analysis | null; dirty: boolean }`
  - `class ProjectRegistry` with: `register(rootUri: string): Project`, `setBases(rootUri: string, bases: TodlDocument[]): void`, `projectFor(uri: string): Project | null`, `markDirty(rootUri: string): void`, `dirtyProjects(): Project[]`, `all(): Project[]`, `remove(rootUri: string): void`.

- [ ] **Step 1: Write the failing test**

Create `src/language-server/tests/workspace.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectRegistry } from "../workspace.js";

test("assigns a document to its project by longest-prefix match", () => {
  const reg = new ProjectRegistry();
  reg.register("todl://p1/");
  reg.register("todl://p1/nested/");   // longer prefix wins
  assert.equal(reg.projectFor("todl://p1/a.todl")?.rootUri, "todl://p1/");
  assert.equal(reg.projectFor("todl://p1/nested/b.todl")?.rootUri, "todl://p1/nested/");
  assert.equal(reg.projectFor("todl://other/x.todl"), null);
});

test("setBases registers the root and stores bases; markDirty flags it", () => {
  const reg = new ProjectRegistry();
  reg.setBases("todl://p/", []);
  const p = reg.projectFor("todl://p/x.todl")!;
  assert.deepEqual(p.bases, []);
  assert.equal(p.dirty, false);
  reg.markDirty("todl://p/");
  assert.equal(reg.dirtyProjects().length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-server/tests/workspace.test.ts"`
Expected: FAIL — `../workspace.js` does not exist.

- [ ] **Step 3: Implement `src/language-server/workspace.ts` (registry portion)**

```ts
import type { Analysis } from "@pragmatic-lab/todl/language-service";
import type { TodlDocument } from "@pragmatic-lab/todl";

export interface Project {
  rootUri: string;
  bases: TodlDocument[];
  analysis: Analysis | null;
  dirty: boolean;
}

// Holds every open project and assigns documents to them by longest-prefix match
// on the project root URI, so one server partitions cleanly.
export class ProjectRegistry {
  private readonly projects = new Map<string, Project>();

  register(rootUri: string): Project {
    let p = this.projects.get(rootUri);
    if (p === undefined) {
      p = { rootUri, bases: [], analysis: null, dirty: true };
      this.projects.set(rootUri, p);
    }
    return p;
  }

  setBases(rootUri: string, bases: TodlDocument[]): void {
    const p = this.register(rootUri);
    p.bases = bases;
    p.dirty = true;
  }

  projectFor(uri: string): Project | null {
    let best: Project | null = null;
    for (const p of this.projects.values()) {
      if (uri.startsWith(p.rootUri) && (best === null || p.rootUri.length > best.rootUri.length)) best = p;
    }
    return best;
  }

  markDirty(rootUri: string): void {
    const p = this.projects.get(rootUri);
    if (p !== undefined) p.dirty = true;
  }

  dirtyProjects(): Project[] { return [...this.projects.values()].filter((p) => p.dirty); }
  all(): Project[] { return [...this.projects.values()]; }
  remove(rootUri: string): void { this.projects.delete(rootUri); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-server/tests/workspace.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language-server/workspace.ts src/language-server/tests/workspace.test.ts
git commit -m "feat(language-server): ProjectRegistry with prefix-match partitioning"
```

---

### Task 4: Source providers (pushed + FS)

The seam that supplies each project's `SourceFile[]`: open-buffer text (pushed) or on-disk `*.todl` overlaid with open buffers (FS).

**Files:**
- Modify: `src/language-server/workspace.ts` (add the provider interface + two implementations)
- Test: `src/language-server/tests/source-providers.test.ts`

**Interfaces:**
- Consumes: `Project` (Task 3); `TextDocuments<TextDocument>` from `vscode-languageserver`/`vscode-languageserver-textdocument`; `SourceFile` from `@pragmatic-lab/todl`; Node `fs`, `url`.
- Produces:
  - `interface SourceProvider { initialRoots(folders: string[]): string[]; sourcesFor(project: Project, docs: TextDocuments<TextDocument>): SourceFile[] }`
  - `class PushedSourceProvider implements SourceProvider`
  - `class FsSourceProvider implements SourceProvider`

- [ ] **Step 1: Write the failing test**

Create `src/language-server/tests/source-providers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { PushedSourceProvider, FsSourceProvider, ProjectRegistry } from "../workspace.js";

// A TextDocuments stub exposing just `all()` (the only method providers use).
function docsWith(...docs: TextDocument[]): TextDocuments<TextDocument> {
  return { all: () => docs } as unknown as TextDocuments<TextDocument>;
}

test("pushed provider returns the open documents under the project root", () => {
  const reg = new ProjectRegistry();
  const p = reg.register("todl://p/");
  const docs = docsWith(
    TextDocument.create("todl://p/a.todl", "todl", 1, "namespace demo { }"),
    TextDocument.create("todl://other/b.todl", "todl", 1, "namespace x { }"),
  );
  const sources = new PushedSourceProvider().sourcesFor(p, docs);
  assert.deepEqual(sources.map((s) => s.uri), ["todl://p/a.todl"]);
});

test("fs provider scans *.todl on disk under the root", () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-fs-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "a.todl"), "namespace a { }");
  writeFileSync(join(dir, "sub", "b.todl"), "namespace b { }");
  writeFileSync(join(dir, "note.txt"), "ignore me");
  const rootUri = pathToFileURL(dir).href.replace(/\/?$/, "/");
  const reg = new ProjectRegistry();
  const p = reg.register(rootUri);
  const sources = new FsSourceProvider().sourcesFor(p, docsWith());
  assert.deepEqual(sources.map((s) => s.uri.endsWith(".todl")).every(Boolean), true);
  assert.equal(sources.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-server/tests/source-providers.test.ts"`
Expected: FAIL — the provider classes don't exist.

- [ ] **Step 3: Add the providers to `src/language-server/workspace.ts`**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import type { TextDocuments } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { SourceFile } from "@pragmatic-lab/todl";

export interface SourceProvider {
  // The project roots known at startup (FS: workspace folder URIs; pushed: []).
  initialRoots(folders: string[]): string[];
  // The SourceFile set to analyze for a project.
  sourcesFor(project: Project, docs: TextDocuments<TextDocument>): SourceFile[];
}

// Pushed mode: sources are the live text of open documents under the project root.
export class PushedSourceProvider implements SourceProvider {
  initialRoots(): string[] { return []; }
  sourcesFor(project: Project, docs: TextDocuments<TextDocument>): SourceFile[] {
    return docs.all()
      .filter((d) => d.uri.startsWith(project.rootUri))
      .map((d) => ({ uri: d.uri, text: d.getText() }));
  }
}

// FS mode: scan the root folder for *.todl on disk, overlaying any open buffer.
export class FsSourceProvider implements SourceProvider {
  initialRoots(folders: string[]): string[] { return folders; }
  sourcesFor(project: Project, docs: TextDocuments<TextDocument>): SourceFile[] {
    const dir = fileURLToPath(project.rootUri);
    const open = new Map(docs.all().map((d) => [d.uri, d.getText()] as const));
    const files: SourceFile[] = [];
    for (const path of walkTodl(dir)) {
      const uri = pathToFileURL(path).href;
      files.push({ uri, text: open.get(uri) ?? readFileSync(path, "utf8") });
    }
    return files;
  }
}

function walkTodl(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTodl(path));
    else if (entry.name.endsWith(".todl")) out.push(path);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-server/tests/source-providers.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language-server/workspace.ts src/language-server/tests/source-providers.test.ts
git commit -m "feat(language-server): pushed + FS source providers"
```

---

### Task 5: Server skeleton — connection, capabilities, in-memory harness

`createServer(connection)` sets up `TextDocuments` + `onInitialize` (advertising the full capability set + choosing the provider). A test harness wires an in-memory client↔server connection.

**Files:**
- Replace: `src/language-server/server.ts` (the Task 1 stub)
- Create: `src/language-server/tests/harness.ts`
- Test: `src/language-server/tests/server-lifecycle.test.ts`

**Interfaces:**
- Consumes: `createConnection`, `TextDocuments`, `TextDocumentSyncKind` from `vscode-languageserver/node`; `TextDocument` from `vscode-languageserver-textdocument`; `SEMANTIC_LEGEND` from the core; `ProjectRegistry`, `PushedSourceProvider`, `FsSourceProvider` (Tasks 3–4).
- Produces:
  - `createServer(connection: Connection): void` — registers handlers; the caller calls `connection.listen()`.
  - `startServer(): { client: MessageConnection; dispose: () => void }` (harness).

- [ ] **Step 1: Write the harness `src/language-server/tests/harness.ts`**

```ts
import { PassThrough } from "node:stream";
import { createConnection } from "vscode-languageserver/node.js";
import { StreamMessageReader, StreamMessageWriter, createMessageConnection, type MessageConnection } from "vscode-jsonrpc/node.js";
import { createServer } from "../server.js";

// An in-memory client↔server pair over two pipes — no child process.
export function startServer(): { client: MessageConnection; dispose: () => void } {
  const c2s = new PassThrough();
  const s2c = new PassThrough();
  const server = createConnection(new StreamMessageReader(c2s), new StreamMessageWriter(s2c));
  createServer(server);
  server.listen();
  const client = createMessageConnection(new StreamMessageReader(s2c), new StreamMessageWriter(c2s));
  client.listen();
  return { client, dispose: () => { client.dispose(); c2s.destroy(); s2c.destroy(); } };
}

// A minimal initialize params object for pushed mode.
export function pushedInit() {
  return { processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: "pushed" }, workspaceFolders: null };
}
```

- [ ] **Step 2: Write the failing lifecycle test**

Create `src/language-server/tests/server-lifecycle.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, pushedInit } from "./harness.js";

test("initialize advertises the TODL capabilities", async () => {
  const { client, dispose } = startServer();
  const result = await client.sendRequest("initialize", pushedInit()) as { capabilities: Record<string, unknown> };
  const caps = result.capabilities;
  assert.ok(caps.completionProvider);
  assert.ok(caps.hoverProvider);
  assert.ok(caps.renameProvider);
  assert.ok(caps.semanticTokensProvider);
  dispose();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-server/tests/server-lifecycle.test.ts"`
Expected: FAIL — the stub `createServer` registers no `initialize` handler.

- [ ] **Step 4: Implement `src/language-server/server.ts` (skeleton)**

```ts
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
    const mode = params.initializationOptions?.mode ?? (folders.length > 0 ? "fs" : "pushed");
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-server/tests/server-lifecycle.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-server/server.ts src/language-server/tests/harness.ts src/language-server/tests/server-lifecycle.test.ts
git commit -m "feat(language-server): createServer skeleton + in-memory harness"
```

---

### Task 6: Re-analysis lifecycle + per-URI diagnostics

Wire document open/change/close to per-project dirty-marking + a shared debounce that re-analyzes each dirty project and publishes diagnostics per document URI.

**Files:**
- Modify: `src/language-server/server.ts`
- Test: `src/language-server/tests/server-diagnostics.test.ts`

**Interfaces:**
- Consumes: `analyze` from the core; `Analysis.diagnosticsByUri` (Task 2); `registry`, `documents`, `provider` from Task 5.
- Produces: internal `scheduleRevalidate()` + `revalidate()`; on-change handlers. No new exports.

- [ ] **Step 1: Write the failing test**

Create `src/language-server/tests/server-diagnostics.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, pushedInit } from "./harness.js";

function opened(uri: string, text: string) {
  return { textDocument: { uri, languageId: "todl", version: 1, text } };
}

test("publishes diagnostics for an opened document with a required-missing error", async () => {
  const { client, dispose } = startServer();
  await client.sendRequest("initialize", pushedInit());
  client.sendNotification("initialized", {});
  // Register the project root, then open a file with a missing required field.
  client.sendNotification("todl/setBases", { rootUri: "todl://p/", bases: [] });

  const got = new Promise<{ uri: string; diagnostics: unknown[] }>((resolve) => {
    client.onNotification("textDocument/publishDiagnostics", (p) => {
      if ((p as { diagnostics: unknown[] }).diagnostics.length > 0) resolve(p as { uri: string; diagnostics: unknown[] });
    });
  });
  client.sendNotification("textDocument/didOpen", opened("todl://p/a.todl",
    "namespace demo {\n  primitive string { }\n  concept person { name : string; }\n  person alice { }\n}"));

  const published = await got;
  assert.equal(published.uri, "todl://p/a.todl");
  assert.ok(published.diagnostics.length >= 1);
  dispose();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-server/tests/server-diagnostics.test.ts"`
Expected: FAIL — no diagnostics are ever published (no lifecycle wired, no `todl/setBases` handler).

- [ ] **Step 3: Implement the lifecycle in `src/language-server/server.ts`**

Add the core import:

```ts
import { analyze } from "@pragmatic-lab/todl/language-service";
```

Inside `createServer`, after `const provider = …` and before `documents.listen`, add the debounce + revalidation and the change/notification wiring:

```ts
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRevalidate = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; revalidate(); }, 200);
  };

  const revalidate = (): void => {
    for (const project of registry.dirtyProjects()) {
      project.dirty = false;
      const sources = provider.sourcesFor(project, documents);
      const analysis = analyze(sources, project.bases);
      project.analysis = analysis;
      for (const [uri, diagnostics] of analysis.diagnosticsByUri) {
        connection.sendDiagnostics({ uri, diagnostics });
      }
    }
  };

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
```

(Note: `documents.onDidChangeContent` fires on both open and change, so opening a file triggers a revalidation of its project.)

For FS mode, also revalidate all initial-root projects once after initialize — add at the end of the `onInitialize` handler body, before `return`:

```ts
    scheduleRevalidate();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-server/tests/server-diagnostics.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language-server/server.ts src/language-server/tests/server-diagnostics.test.ts
git commit -m "feat(language-server): debounced per-project revalidation + per-URI diagnostics"
```

---

### Task 7: Request handlers (all core capabilities)

Register one thin handler per capability, each resolving the document's project analysis and delegating to the core.

**Files:**
- Modify: `src/language-server/server.ts`
- Test: `src/language-server/tests/server-requests.test.ts`

**Interfaces:**
- Consumes: the core query fns; `registry`, `documents` from Task 5; LSP request param types from `vscode-languageserver`.
- Produces: registered handlers. No new exports.

- [ ] **Step 1: Write the failing test**

Create `src/language-server/tests/server-requests.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, pushedInit } from "./harness.js";

const SRC = "namespace demo {\n  concept animal { }\n  concept dog : animal { }\n}";

async function ready() {
  const h = startServer();
  await h.client.sendRequest("initialize", pushedInit());
  h.client.sendNotification("initialized", {});
  h.client.sendNotification("todl/setBases", { rootUri: "todl://p/", bases: [] });
  const opened = new Promise<void>((resolve) => {
    h.client.onNotification("textDocument/publishDiagnostics", () => resolve());
  });
  h.client.sendNotification("textDocument/didOpen", { textDocument: { uri: "todl://p/a.todl", languageId: "todl", version: 1, text: SRC } });
  await opened;   // analysis is now cached
  return h;
}

test("hover and definition delegate to the core", async () => {
  const h = await ready();
  // Cursor on the `animal` reference in `: animal` (line 2, char 16).
  const hover = await h.client.sendRequest("textDocument/hover", {
    textDocument: { uri: "todl://p/a.todl" }, position: { line: 2, character: 16 },
  }) as { contents: { value: string } } | null;
  assert.match(hover!.contents.value, /animal/);

  const def = await h.client.sendRequest("textDocument/definition", {
    textDocument: { uri: "todl://p/a.todl" }, position: { line: 2, character: 16 },
  }) as { range: { start: { line: number } } } | null;
  assert.equal(def!.range.start.line, 1);
  h.dispose();
});

test("document symbols delegate to the core", async () => {
  const h = await ready();
  const syms = await h.client.sendRequest("textDocument/documentSymbol", {
    textDocument: { uri: "todl://p/a.todl" },
  }) as { name: string }[];
  assert.deepEqual(syms.map((s) => s.name).sort(), ["animal", "dog"]);
  h.dispose();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-server/tests/server-requests.test.ts"`
Expected: FAIL — no request handlers registered (requests reject / return null).

- [ ] **Step 3: Implement the handlers in `src/language-server/server.ts`**

Add imports:

```ts
import { ResponseError, ErrorCodes } from "vscode-languageserver/node.js";
import {
  completionsAt, hoverAt, definitionAt, referencesAt, prepareRename, renameEdits,
  documentSymbols, foldingRanges, workspaceSymbols, semanticTokens, codeActions,
  formatDocument, signatureHelpAt, type Analysis,
} from "@pragmatic-lab/todl/language-service";
```

Add a resolver + the handlers inside `createServer` (after the lifecycle wiring):

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-server/tests/server-requests.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language-server/server.ts src/language-server/tests/server-requests.test.ts
git commit -m "feat(language-server): request handlers delegating to the core"
```

---

### Task 8: Pushed-mode bases end-to-end

Prove `todl/setBases` makes a base concept resolvable, and multi-project partitioning keeps projects independent.

**Files:**
- Test: `src/language-server/tests/server-bases-multiproject.test.ts`

**Interfaces:**
- Consumes: the harness; the core's `analyze` (to build a base `TodlDocument` fixture via `toJSON`).

- [ ] **Step 1: Write the test**

Create `src/language-server/tests/server-bases-multiproject.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, toJSON } from "@pragmatic-lab/todl";
import { startServer, pushedInit } from "./harness.js";

// Compile a base model defining `element` with a REQUIRED `label` field. The
// base's schema is what makes an instance missing `label` an error — proving the
// pushed base actually reached the analysis (an unresolved reference, by
// contrast, is silently stubbed and would never diagnose).
function baseDoc(): unknown {
  const { model } = check([{ uri: "base.todl", text: "namespace base {\n  concept element { label : string; }\n}" }]);
  return toJSON(model);
}

function waitDiag(client: { onNotification: Function }, uri: string) {
  return new Promise<{ message?: string }[]>((resolve) => {
    client.onNotification("textDocument/publishDiagnostics", (p: { uri: string; diagnostics: { message?: string }[] }) => {
      if (p.uri === uri) resolve(p.diagnostics);
    });
  });
}

test("a pushed base's schema drives validation (required field from the base)", async () => {
  const { client, dispose } = startServer();
  await client.sendRequest("initialize", pushedInit());
  client.sendNotification("initialized", {});
  client.sendNotification("todl/setBases", { rootUri: "todl://p/", bases: [baseDoc()] });
  const diag = waitDiag(client, "todl://p/m.todl");
  // An `element` instance missing the base-declared required `label`.
  client.sendNotification("textDocument/didOpen", { textDocument: {
    uri: "todl://p/m.todl", languageId: "todl", version: 1,
    text: "namespace m {\n  element e { }\n}",
  } });
  const diagnostics = await diag;
  assert.ok(diagnostics.length >= 1);
  assert.ok(diagnostics.some((d) => (d.message ?? "").includes("label")));
  dispose();
});

test("two projects validate independently", async () => {
  const { client, dispose } = startServer();
  await client.sendRequest("initialize", pushedInit());
  client.sendNotification("initialized", {});
  client.sendNotification("todl/setBases", { rootUri: "todl://a/", bases: [] });
  client.sendNotification("todl/setBases", { rootUri: "todl://b/", bases: [] });
  const diagB = waitDiag(client, "todl://b/x.todl");
  client.sendNotification("textDocument/didOpen", { textDocument: { uri: "todl://a/x.todl", languageId: "todl", version: 1, text: "namespace a {\n  concept a1 { }\n}" } });
  client.sendNotification("textDocument/didOpen", { textDocument: { uri: "todl://b/x.todl", languageId: "todl", version: 1, text: "namespace b {\n  concept b1 { }\n}" } });
  assert.deepEqual(await diagB, []);   // b is clean and published on its own
  dispose();
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-server/tests/server-bases-multiproject.test.ts"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/language-server/tests/server-bases-multiproject.test.ts
git commit -m "test(language-server): pushed-mode bases + multi-project independence"
```

---

### Task 9: FS mode end-to-end

Point the server at a temp directory of `.todl` files (FS mode) and confirm diagnostics + a workspace-symbol query resolve, with no external base resolution.

**Files:**
- Test: `src/language-server/tests/server-fs.test.ts`

**Interfaces:**
- Consumes: the harness (extended with an FS-mode init); Node `fs`, `os`, `path`, `url`.

- [ ] **Step 1: Add an FS-mode init helper to the harness**

Append to `src/language-server/tests/harness.ts`:

```ts
export function fsInit(folderUri: string) {
  return { processId: null, rootUri: folderUri, capabilities: {}, initializationOptions: { mode: "fs" },
    workspaceFolders: [{ uri: folderUri, name: "ws" }] };
}
```

- [ ] **Step 2: Write the test**

Create `src/language-server/tests/server-fs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startServer, fsInit } from "./harness.js";

test("FS mode scans the workspace, publishes diagnostics, and answers workspace symbols", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-lsp-fs-"));
  writeFileSync(join(dir, "m.todl"), "namespace m {\n  concept gadget { }\n}");
  const rootUri = pathToFileURL(dir).href.replace(/\/?$/, "/");

  const { client, dispose } = startServer();
  const gotDiag = new Promise<void>((resolve) => {
    client.onNotification("textDocument/publishDiagnostics", () => resolve());
  });
  await client.sendRequest("initialize", fsInit(rootUri));
  client.sendNotification("initialized", {});
  await gotDiag;   // the scanned file was analyzed + published

  const syms = await client.sendRequest("workspace/symbol", { query: "gadget" }) as { name: string }[];
  assert.deepEqual(syms.map((s) => s.name), ["gadget"]);
  dispose();
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-server/tests/server-fs.test.ts"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/language-server/tests/harness.ts src/language-server/tests/server-fs.test.ts
git commit -m "test(language-server): FS-mode workspace scanning end-to-end"
```

---

### Task 10: stdio entry + full gate

Add the `bin` entry point and confirm the whole repo is green under strict tsc.

**Files:**
- Create: `src/language-server/stdio.ts`
- Test: `src/language-server/tests/stdio.test.ts`

**Interfaces:**
- Consumes: `createServer`, `createConnection` from `./server.js`.
- Produces: the `todl-language-server` binary entry (built to `dist/language-server/stdio.js`).

- [ ] **Step 1: Implement `src/language-server/stdio.ts`**

```ts
import { createConnection, createServer } from "./server.js";

// The stdio entry point: Electron main forks this, and an external editor
// (e.g. a VS Code extension) spawns the same file.
const connection = createConnection(process.stdin, process.stdout);
createServer(connection);
connection.listen();
```

- [ ] **Step 2: Write a smoke test that the entry module loads**

Create `src/language-server/tests/stdio.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("stdio entry exports nothing but imports cleanly (surface check via server barrel)", async () => {
  // Importing stdio.ts would start reading process.stdin, so we assert the
  // server module it depends on exposes the expected factory instead.
  const mod = await import("../server.js");
  assert.equal(typeof mod.createServer, "function");
  assert.equal(typeof mod.createConnection, "function");
});
```

- [ ] **Step 3: Run the language-server suite**

Run: `npx tsx --conditions=development --test "src/language-server/**/*.test.ts"`
Expected: PASS — every language-server test.

- [ ] **Step 4: Run the FULL suite**

Run: `npm test`
Expected: PASS — the whole repo (core + server).

- [ ] **Step 5: Typecheck (strict)**

Run: `npx tsc --noEmit`
Expected: no errors. (Watch `params.initializationOptions?.mode` — type it as `{ mode?: string } | undefined`; guard `p.textDocument`/indexed access.)

- [ ] **Step 6: Commit**

```bash
git add src/language-server/stdio.ts src/language-server/tests/stdio.test.ts
git commit -m "feat(language-server): stdio bin entry + full-suite gate"
```

---

## Self-Review

**1. Spec coverage:**
- Packaging (subpath export + `bin`, deps) → Task 1. ✓
- Per-URI diagnostics (core needed grouping) → Task 2. ✓
- Multi-project registry + prefix partitioning → Task 3. ✓
- `SourceProvider` seam + pushed + FS providers → Task 4. ✓
- Capabilities + provider selection at initialize → Task 5. ✓
- Debounced per-project re-analysis + per-URI publish → Task 6. ✓
- All request handlers (thin delegation) → Task 7. ✓
- `todl/setBases`/`todl/refreshBases` + pushed bases + multi-project independence → Tasks 6, 8. ✓
- FS-mode self-contained (no external bases) → Tasks 4, 9. ✓
- stdio `bin` entry → Task 10. ✓
- Error handling (core throw → project-level diagnostic): the core already degrades to a whole-model diagnostic on a throw (Spec 1 `validateSources`/`checkAgainst` path), which Task 2's `diagnosticsByUri` attaches to every file — so a core throw surfaces per-file without extra server code. Verified by the existing core behavior; no separate task needed.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". The Task 1 stub `server.ts` is explicitly a placeholder replaced in Task 5, stated inline.

**3. Type consistency:** `Project`/`ProjectRegistry`/`SourceProvider` (Tasks 3–4) are consumed with identical shapes in `server.ts` (Tasks 5–7). `analysisFor(uri)` returns `Analysis | null` and every handler guards the null. `todl/setBases`/`todl/refreshBases` params `{ rootUri, bases }` match `registry.setBases(rootUri, bases)`. `Analysis.diagnosticsByUri` (Task 2) is consumed in the Task 6 revalidation loop. `SEMANTIC_LEGEND` (advertised in Task 5) matches the core export used by `semanticTokens` (Task 7). Harness `startServer`/`pushedInit`/`fsInit` signatures match every test's usage.
