# TODL Tests & Demos — Phase 2 Implementation Plan (Mural app, text phase)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runnable Mural browser app — playground + gallery + docs-showcase — over the Phase 1 corpus, delivering use cases 1 (interactive playground) and 4 (docs-driven showcase). Output panels are text (diagnostics / emitted JSON / model). The graph-diagram view is Phase 3.

**Architecture:** A Vite-bundled Mural app in `app/` (foundation already committed, spike-validated). One `AppVM` owns the active page; a root `.mu` layout hosts a nav rail + a `ContentControl` bound to the active page VM, each page resolved by a `DataTemplate [DataType = PageVM]`. A single reused `ExampleRunnerVM` (editor + live compile + text output) backs all three pages. The app consumes the same pure `shared/` (corpus + verify) as the CLI/tests; a new pure `shared/compile-for-display` compiles arbitrary editor text for the playground.

**Tech Stack:** Mural 0.45 (`@pragmatic-tech-ai/mural`, `file:../../Mural`), Vite 5, the todl compiler via `@pragmatic-tech-ai/todl` (aliased to `../dist`), Playwright + system Edge for UI verification.

**Spec:** `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md` (§ "The Mural app")

## Global Constraints

- **Foundation is committed and validated** (`app/` — commit 47cfdee). Do NOT re-derive the Vite config; build on it. Its non-obvious, mandatory settings (verified in the spike):
  - `esbuild: { keepNames: true }` — Mural resolves themes/schemes/**DataTemplates by `Class.name`**; renaming breaks all of it. NEVER remove.
  - `build: { target: "esnext" }` — bootstrap uses top-level `await`.
  - opentype.js shim + **exact-regex** alias `{ find: /^opentype\.js$/ }`; `opentype.js` is a direct dependency.
  - `@pragmatic-tech-ai/todl` → `../dist/index.js`; **the repo root `npm run build` must run first** so the alias resolves.
  - `server.fs.allow` includes repo root + sibling Mural.
- **Page hosting rule (spike-verified):** a bare `ContentControl` as `Resources.Root` renders nothing; it MUST be hosted inside a layout container (Grid/DockPanel/Border) that measures it. Templated VMs then resolve and render (`$`-bindings + DataContext work).
- **Theme init:** `app.initialize({ theme: Material, autoScheme: { light: MaterialLight, dark: MaterialDark } })`, then `await document.fonts.ready`, then `app.initialize(new HtmlTarget(el))`.
- **`shared/` stays pure** (compiler + JS only; no Mural, no DOM) — enforced from Phase 1. New display-compile logic goes in `shared/`; all Mural code stays in `app/`.
- **`app/` stays out of the published package** (`files` unchanged; `app/node_modules` + `app/dist` already git-ignored).
- **`.mu` compiles on the fly via `vitePluginMural`** — no committed `.mu.js`. Author `.mu` + a sibling VM `.ts`.
- **UI verification** uses the committed render-harness pattern: `vite preview` + Playwright driving `chromium.launch({ channel: "msedge" })` (bundled browsers are not installed). Assert on SVG `<text>` content.

## File Structure

```
app/
  index.html                       # exists (foundation)
  vite.config.ts                   # exists (foundation) — do not weaken
  package.json                     # exists — add vitest OR keep node:test for VM logic
  src/
    main.ts                        # REWRITE: bootstrap AppVM + shell root
    app-vm.ts                      # AppVM: ActivePage + navigation commands
    shell.mu                       # root layout: nav rail + ContentControl = $ActivePage
    pages/
      playground/{playground-vm.ts, playground.mu}
      gallery/{gallery-vm.ts, gallery-card-vm.ts, gallery.mu}
      docs/{docs-vm.ts, docs-section-vm.ts, docs.mu}
    components/example-runner/
      example-runner-vm.ts         # editor + live compile + output panels (shared by pages)
      example-runner.mu
      diagnostic-vm.ts             # one row in the diagnostics list
    ui-verify/render-check.mjs     # committed Playwright+Edge harness (from the spike)
shared/
  compile-for-display.ts           # NEW pure: compile arbitrary source → display model
  tests/compile-for-display.test.ts
```

## Interfaces produced (referenced across tasks)

- `shared/compile-for-display.ts`:
  - `interface DisplayResult { diagnostics: GoldenDiagnostic[]; document: TodlDocument; ok: boolean }`
  - `compileForDisplay(sources: ExampleSource[]): DisplayResult` — runs `check` with a fresh `DeterministicIdGenerator`, returns canonicalized diagnostics (reusing Phase 1 normalize helpers) + the emitted own-nodes document + `ok = no error-severity diagnostics`.
- `app/src/components/example-runner/example-runner-vm.ts`:
  - `class ExampleRunnerVM extends MuralBase` with DPs `Source: string` (two-way), `Editable: boolean`, `DiagnosticsText: string`, `Json: string`, `ActivePanel: string`, `Diagnostics: DiagnosticVM[]`, command `Run`. Method `loadExample(entry: CorpusEntry)`.
- `app/src/app-vm.ts`:
  - `class AppVM extends MuralBase` with `ActivePage: MuralBase`, commands `ShowPlayground/ShowGallery/ShowDocs`, and `openInPlayground(entry: CorpusEntry)`.

---

## Task 1: App shell + navigation (proves end-to-end page hosting)

Establish the root layout, `AppVM`, and page-switching. Pages are placeholder VMs that render their title, so this task proves the spike-verified hosting mechanism at app scale before real pages exist.

**Files:**
- Rewrite: `app/src/main.ts`
- Create: `app/src/app-vm.ts`, `app/src/shell.mu`
- Create: `app/src/pages/playground/playground-vm.ts` (placeholder: a `Title` DP = "Playground"), and matching placeholder VMs for gallery/docs
- Create: `app/src/ui-verify/render-check.mjs`

**Interfaces:**
- Produces: `AppVM` (see above); placeholder page VMs each with `Title: string`.

- [ ] **Step 1: Write `app/src/app-vm.ts`**

```ts
import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "../../shared/corpus-types.js";
import { PlaygroundVM } from "./pages/playground/playground-vm.js";
import { GalleryVM } from "./pages/gallery/gallery-vm.js";
import { DocsVM } from "./pages/docs/docs-vm.js";

export class AppVM extends MuralBase {
  static ActivePageKey = MuralBase.RegisterProperty<MuralBase | undefined>(AppVM, "ActivePage", undefined, MetaData.None);
  static ShowPlaygroundKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowPlayground", undefined, MetaData.None);
  static ShowGalleryKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowGallery", undefined, MetaData.None);
  static ShowDocsKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowDocs", undefined, MetaData.None);

  private readonly playground = new PlaygroundVM();
  private readonly gallery = new GalleryVM();
  private readonly docs = new DocsVM();

  get ActivePage(): MuralBase | undefined { return this.get_property_value(AppVM.ActivePageKey); }
  get ShowPlayground(): ICommand | undefined { return this.get_property_value(AppVM.ShowPlaygroundKey); }
  get ShowGallery(): ICommand | undefined { return this.get_property_value(AppVM.ShowGalleryKey); }
  get ShowDocs(): ICommand | undefined { return this.get_property_value(AppVM.ShowDocsKey); }

  constructor() {
    super();
    this.set_property_value(AppVM.ActivePageKey, this.playground);
    this.set_property_value(AppVM.ShowPlaygroundKey, new RelayCommand(() => this.set_property_value(AppVM.ActivePageKey, this.playground)));
    this.set_property_value(AppVM.ShowGalleryKey, new RelayCommand(() => this.set_property_value(AppVM.ActivePageKey, this.gallery)));
    this.set_property_value(AppVM.ShowDocsKey, new RelayCommand(() => this.set_property_value(AppVM.ActivePageKey, this.docs)));
  }

  openInPlayground(entry: CorpusEntry): void {
    this.playground.load(entry);
    this.set_property_value(AppVM.ActivePageKey, this.playground);
  }
}
```
> Note: `PlaygroundVM.load` is a no-op placeholder until Task 4; `GalleryVM` gains its `AppVM` back-reference in Task 5 (change `new GalleryVM()` to `new GalleryVM(this)` then).

- [ ] **Step 2: Write placeholder page VMs** (playground/gallery/docs), each:

```ts
import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
export class PlaygroundVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(PlaygroundVM, "Title", "Playground", MetaData.None);
  get Title(): string { return this.get_property_value(PlaygroundVM.TitleKey); }
  load(_entry: unknown): void { /* Task 4 */ }
}
```
(Repeat for `GalleryVM` → "Gallery", `DocsVM` → "Docs"; gallery/docs need no `load`.)

- [ ] **Step 3: Write `app/src/shell.mu`** — root layout: nav rail (three buttons) + a content host bound to `$ActivePage`, plus per-page placeholder templates.

```
import AppVM from "./app-vm.ts"
import PlaygroundVM from "./pages/playground/playground-vm.ts"
import GalleryVM from "./pages/gallery/gallery-vm.ts"
import DocsVM from "./pages/docs/docs-vm.ts"

resources AppShell {
    DataTemplate [DataType = PlaygroundVM] { Border [ Fill = @Surface ] { TextBlock [ Margin = (24,24,24,24), FontSize = 20, Text = $Title ] } }
    DataTemplate [DataType = GalleryVM]    { Border [ Fill = @Surface ] { TextBlock [ Margin = (24,24,24,24), FontSize = 20, Text = $Title ] } }
    DataTemplate [DataType = DocsVM]       { Border [ Fill = @Surface ] { TextBlock [ Margin = (24,24,24,24), FontSize = 20, Text = $Title ] } }

    DataTemplate [DataType = AppVM] {
        DockPanel {
            Border [ DockPanel.Dock = Left, Fill = @SurfaceVariant, Width = 160 ] {
                StackPanel [ Orientation = Vertical, Margin = (8,8,8,8) ] {
                    Button [ Command = $ShowPlayground, Margin = (0,0,0,4) ] { TextBlock [ Text = "Playground" ] }
                    Button [ Command = $ShowGallery,    Margin = (0,0,0,4) ] { TextBlock [ Text = "Gallery" ] }
                    Button [ Command = $ShowDocs ]                          { TextBlock [ Text = "Docs" ] }
                }
            }
            ContentControl [ Content = $ActivePage ]
        }
    }
}
```
> The `ContentControl` is hosted inside a `DockPanel` (a layout container), satisfying the hosting rule. `Content = $ActivePage` re-resolves the page template on each switch.

- [ ] **Step 4: Rewrite `app/src/main.ts`** to mount `AppVM` through the shell:

```ts
import { Application } from "@pragmatic-tech-ai/mural/runtime";
import { ContentControl } from "@pragmatic-tech-ai/mural/framework";
import { Border } from "@pragmatic-tech-ai/mural/basic";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { Material, MaterialLight, MaterialDark } from "@pragmatic-tech-ai/mural/resources/material";
// @ts-expect-error compiled by vitePluginMural
import { AppShell } from "./shell.mu";
import { AppVM } from "./app-vm.js";

const app = new Application();
app.initialize({ theme: Material, autoScheme: { light: MaterialLight, dark: MaterialDark } });
for (const [k, v] of AppShell.Clone().Entries()) app.Resources.Set(k, v);

// ContentControl (resolves the AppVM template) hosted inside a Border so it is
// laid out — a bare ContentControl root renders nothing (spike-verified).
const host = new ContentControl();
host.Content = new AppVM();
const root = new Border();
root.SetChild(host);
app.Resources.Root = root;

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));
```

- [ ] **Step 5: Write the render harness** `app/src/ui-verify/render-check.mjs` (parameterize URL + assertions):

```js
import pw from "file:///C:/Users/Eugene/Projects/architecture-agent/Plexus/node_modules/playwright/index.js";
const { chromium } = pw;
const url = process.argv[2] ?? "http://localhost:4319/";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const texts = await page.evaluate(() =>
  Array.from(document.querySelectorAll("#app svg text")).map((t) => t.textContent));
console.log(JSON.stringify({ texts, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
```
> Playwright is resolved from Plexus's install; `channel: "msedge"` uses system Edge. Keep this path as a documented dev dependency of the check, not of the app bundle.

- [ ] **Step 6: Build + verify render + click-through**

```bash
cd app && npx vite build && npx vite preview --port 4319 --strictPort &
node src/ui-verify/render-check.mjs http://localhost:4319/
```
Expected: `texts` includes `"Playground"`, `"Gallery"`, `"Docs"` (nav) and `"Playground"` (active page). No `errors`. Then extend the harness once to click the "Gallery" nav button and assert the active-page text becomes `"Gallery"` (proves command-driven navigation + template re-resolution). Kill the preview server.

- [ ] **Step 7: Commit**

```bash
git add app/src
git commit -m "feat(demos): app shell + AppVM navigation (3 placeholder pages)"
```

---

## Task 2: `shared/compile-for-display` (pure)

The playground compiles arbitrary editor text, not just corpus examples. Add a pure display-compile to `shared/` reusing Phase 1's normalize helpers.

**Files:**
- Create: `shared/compile-for-display.ts`
- Test: `shared/tests/compile-for-display.test.ts`
- Modify: `shared/verify.ts` — export the internal `normalize` (already exported) and, if needed, extract the own-node selection helper so both modules share it. (Phase 1 `normalize` and `DeterministicIdGenerator` are already exported.)

**Interfaces:**
- Consumes: `check`, `toJSONOwn` from `@pragmatic-tech-ai/todl`; `normalize`, `DeterministicIdGenerator` from `./verify.js`.
- Produces: `compileForDisplay(sources: ExampleSource[]): DisplayResult`.

- [ ] **Step 1: Write the failing test** `shared/tests/compile-for-display.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileForDisplay } from "../compile-for-display.js";

test("clean source compiles to ok=true with nodes and no error diagnostics", () => {
  const r = compileForDisplay([{ name: "m.todl", text:
    `namespace app { concept C { label : string; } model M : app { C c { label = "x"; } } }` }]);
  assert.equal(r.ok, true);
  assert.ok(r.document.nodes.length > 0);
  assert.equal(r.diagnostics.filter((d) => d.severity === "error").length, 0);
});

test("erroneous source reports ok=false with a diagnostic", () => {
  const r = compileForDisplay([{ name: "m.todl", text:
    `namespace app { concept C { label : string; } model M : app { C c { } } }` }]);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === "cardinality.required-missing"));
});

test("syntactically broken source does not throw", () => {
  const r = compileForDisplay([{ name: "m.todl", text: `namespace app { concept @@@ }` }]);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.length >= 1);
});
```

- [ ] **Step 2: Run → FAIL** (`npx tsx --conditions=development --test "shared/tests/compile-for-display.test.ts"`).

- [ ] **Step 3: Write `shared/compile-for-display.ts`**

```ts
import { check, toJSONOwn, type TodlDocument } from "@pragmatic-tech-ai/todl";
import type { ExampleSource, GoldenDiagnostic } from "./corpus-types.js";
import { DeterministicIdGenerator, normalize } from "./verify.js";

export interface DisplayResult {
  diagnostics: GoldenDiagnostic[];
  document: TodlDocument;
  ok: boolean;
}

/** Compile editor text for on-screen display: canonicalized diagnostics + the
 *  own-nodes document. Pure — no golden comparison, no filesystem. */
export function compileForDisplay(sources: ExampleSource[]): DisplayResult {
  const idGen = new DeterministicIdGenerator();
  const { model, diagnostics, provenance } = check(sources.map((s) => ({ uri: s.name, text: s.text })), idGen);
  // Reuse Phase 1 normalization for stable, readable output. Own nodes here use
  // provenance (authored instances/ontology captured by the loader); for display
  // we want everything the source added — fall back to all-authored via the same
  // exclusion approach verify uses. Keep it simple: emit provenance-scoped doc.
  const ownIds = new Set(provenance.keys());
  const golden = normalize({ document: toJSONOwn(model, ownIds), diagnostics });
  return { diagnostics: golden.diagnostics, document: golden.document, ok: golden.diagnostics.every((d) => d.severity !== "error") };
}
```
> If the provenance-scoped document proves too sparse in practice (Phase 1 found provenance is instance-only), switch to verify's prelude-exclusion selection by extracting that helper from `verify.ts` into a shared internal and calling it here. Decide by eyeballing a compiled example's node count in Task 3's UI.

- [ ] **Step 4: Run → PASS.** Commit:

```bash
git add shared/compile-for-display.ts shared/tests/compile-for-display.test.ts
git commit -m "feat(demos): pure compile-for-display for the playground"
```

---

## Task 3: `ExampleRunnerVM` + view (editor + live output)

The reused component: an editor, a Run command with debounced auto-run, and three text output panels (diagnostics list / JSON / model summary) switched by a `SegmentedButton`.

**Files:**
- Create: `app/src/components/example-runner/example-runner-vm.ts`
- Create: `app/src/components/example-runner/diagnostic-vm.ts`
- Create: `app/src/components/example-runner/example-runner.mu`

**Interfaces:**
- Consumes: `compileForDisplay`, `DisplayResult` (Task 2); `CorpusEntry` (Phase 1).
- Produces: `ExampleRunnerVM`, `DiagnosticVM`.

- [ ] **Step 1: Write `diagnostic-vm.ts`**

```ts
import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import type { GoldenDiagnostic } from "../../../../shared/corpus-types.js";

export class DiagnosticVM extends MuralBase {
  static LineKey = MuralBase.RegisterProperty<string>(DiagnosticVM, "Line", "", MetaData.None);
  get Line(): string { return this.get_property_value(DiagnosticVM.LineKey); }
  constructor(d: GoldenDiagnostic) {
    super();
    const at = d.span ? ` (${d.span.uri}:${d.span.start.line}:${d.span.start.column})` : "";
    this.set_property_value(DiagnosticVM.LineKey, `${d.severity} ${d.code}${at} — ${d.message}`);
  }
}
```

- [ ] **Step 2: Write `example-runner-vm.ts`**

```ts
import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { compileForDisplay } from "../../../../shared/compile-for-display.js";
import { DiagnosticVM } from "./diagnostic-vm.js";

export class ExampleRunnerVM extends MuralBase {
  static SourceKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Source", "", MetaData.None);
  static EditableKey = MuralBase.RegisterProperty<boolean>(ExampleRunnerVM, "Editable", true, MetaData.None);
  static JsonKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Json", "", MetaData.None);
  static DiagnosticsKey = MuralBase.RegisterProperty<DiagnosticVM[]>(ExampleRunnerVM, "Diagnostics", [], MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Status", "", MetaData.None);
  static RunKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "Run", undefined, MetaData.None);

  get Source(): string { return this.get_property_value(ExampleRunnerVM.SourceKey); }
  set Source(v: string) { this.set_property_value(ExampleRunnerVM.SourceKey, v); }
  get Editable(): boolean { return this.get_property_value(ExampleRunnerVM.EditableKey); }
  get Json(): string { return this.get_property_value(ExampleRunnerVM.JsonKey); }
  get Diagnostics(): DiagnosticVM[] { return this.get_property_value(ExampleRunnerVM.DiagnosticsKey); }
  get Status(): string { return this.get_property_value(ExampleRunnerVM.StatusKey); }
  get Run(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.RunKey); }

  private fileName = "playground.todl";

  constructor() {
    super();
    this.set_property_value(ExampleRunnerVM.RunKey, new RelayCommand(() => this.compile()));
    // Debounced auto-run on edit.
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.AddPropertyChangedListener(ExampleRunnerVM.SourceKey, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.compile(), 300);
    });
  }

  load(entry: CorpusEntry): void {
    this.fileName = entry.sources[0]?.name ?? "example.todl";
    this.set_property_value(ExampleRunnerVM.SourceKey, entry.sources.map((s) => s.text).join("\n\n"));
    // Setting Source triggers the debounced compile.
  }

  compile(): void {
    const r = compileForDisplay([{ name: this.fileName, text: this.Source }]);
    this.set_property_value(ExampleRunnerVM.DiagnosticsKey, r.diagnostics.map((d) => new DiagnosticVM(d)));
    this.set_property_value(ExampleRunnerVM.JsonKey, JSON.stringify(r.document, null, 2));
    this.set_property_value(ExampleRunnerVM.StatusKey, r.ok ? "OK" : `${r.diagnostics.length} problem(s)`);
  }
}
```

- [ ] **Step 3: Write `example-runner.mu`** — editor + output panels.

```
import ExampleRunnerVM from "./example-runner-vm.ts"
import DiagnosticVM from "./diagnostic-vm.ts"

resources ExampleRunner {
    DataTemplate [DataType = DiagnosticVM] {
        TextBlock [ Margin = (0,0,0,2), FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, Text = $Line ]
    }
    DataTemplate [DataType = ExampleRunnerVM] {
        Grid [ ColumnDefinitions = "1*, 1*" ] {
            TextBox
                [ Grid.Column   = 0,
                  Margin        = (8,8,8,8),
                  AcceptsReturn = true,
                  AcceptsTab    = true,
                  TextWrapping  = NoWrap,
                  IsReadOnly    = {{ !$Editable }},
                  FontFamily    = "Cascadia Mono, Consolas, monospace",
                  FontSize      = 13,
                  Text          = $Source ]
            DockPanel [ Grid.Column = 1, Margin = (8,8,8,8) ] {
                TextBlock [ DockPanel.Dock = Top, FontWeight = Bold, Margin = (0,0,0,6), Text = $Status ]
                ListBox   [ DockPanel.Dock = Top, Items = $Diagnostics, Height = 140 ]
                ScrollViewer {
                    TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $Json ]
                }
            }
        }
    }
}
```
> `Text = $Source` is two-way automatically (`TextBox.Text` is `BindsTwoWayByDefault`), so edits push into the VM and trigger the debounced compile. `{{ !$Editable }}` binds read-only for the docs page. (If the `{{ }}` expression form or `!` is unsupported, add an `Editable`-derived `IsReadOnly` DP on the VM instead — verify in Step 4.)

- [ ] **Step 4: Wire a temporary harness page + verify render.** Temporarily set `AppVM`'s initial `ActivePage` to a `new ExampleRunnerVM()` pre-loaded with a corpus example, merge `ExampleRunner` resources in `main.ts`, `vite build`, preview, and run `render-check.mjs`. Assert the SVG `<text>` includes emitted-JSON fragments (e.g. `"nodes"`) and no `errors`. Manually confirm (screenshot) the editor shows source and the diagnostics list renders. Revert the temporary wiring.

- [ ] **Step 5: Commit**

```bash
git add app/src/components
git commit -m "feat(demos): ExampleRunnerVM — editor + live compile + text output panels"
```

---

## Task 4: Playground page (use case 1)

`PlaygroundVM` embeds an editable `ExampleRunnerVM` and a corpus picker that loads any example into the editor.

**Files:**
- Rewrite: `app/src/pages/playground/playground-vm.ts`
- Create: `app/src/pages/playground/playground.mu`
- Modify: `app/src/main.ts` (merge `Playground` + `ExampleRunner` resources)

- [ ] **Step 1: `playground-vm.ts`** — holds a `Runner: ExampleRunnerVM` and `Examples: CorpusEntry[]` (from `shared/corpus`), plus `load(entry)` delegating to the runner. Seed the runner with the first corpus example so the page is non-empty on open.

```ts
import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import { CORPUS } from "../../../../examples/corpus.generated.js";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { ExampleRunnerVM } from "../../components/example-runner/example-runner-vm.js";

export class PlaygroundVM extends MuralBase {
  static RunnerKey = MuralBase.RegisterProperty<ExampleRunnerVM>(PlaygroundVM, "Runner", undefined as unknown as ExampleRunnerVM, MetaData.None);
  static ExamplesKey = MuralBase.RegisterProperty<CorpusEntry[]>(PlaygroundVM, "Examples", [], MetaData.None);
  static SelectedKey = MuralBase.RegisterProperty<CorpusEntry | undefined>(PlaygroundVM, "Selected", undefined, MetaData.None);

  get Runner(): ExampleRunnerVM { return this.get_property_value(PlaygroundVM.RunnerKey); }
  get Examples(): CorpusEntry[] { return this.get_property_value(PlaygroundVM.ExamplesKey); }

  constructor() {
    super();
    const runner = new ExampleRunnerVM();
    this.set_property_value(PlaygroundVM.RunnerKey, runner);
    this.set_property_value(PlaygroundVM.ExamplesKey, CORPUS);
    if (CORPUS[0]) runner.load(CORPUS[0]);
    // When the picker selection changes, load it.
    this.AddPropertyChangedListener(PlaygroundVM.SelectedKey, () => {
      const sel = this.get_property_value(PlaygroundVM.SelectedKey);
      if (sel) runner.load(sel);
    });
  }

  load(entry: CorpusEntry): void { this.Runner.load(entry); }
}
```

- [ ] **Step 2: `playground.mu`** — a `ComboBox` (Items = `$Examples`, SelectedItem = `$Selected`, showing `manifest.title`) above a `ContentControl [ Content = $Runner ]`. (The runner template comes from `ExampleRunner` resources.) For the ComboBox item text, add a small `DataTemplate [DataType = CorpusEntry]`? — `CorpusEntry` is a plain object, not a VM, so instead expose a display-string: either wrap entries in a lightweight `ExampleRefVM { Title, entry }` list, or bind the ComboBox `DisplayMemberPath`-style via a template. Simplest: build `ExampleRefVM[]` in the VM. Adjust Step 1 to expose `Refs: ExampleRefVM[]` and select on those.

> Implementer decision (make it, don't defer): add `app/src/pages/playground/example-ref-vm.ts` with `{ Title: string; entry: CorpusEntry }` and bind the ComboBox to `Refs`. This keeps templating by-type clean (Mural resolves `DataTemplate [DataType = ExampleRefVM]`).

- [ ] **Step 3: Merge resources in `main.ts`**, build, preview, verify with `render-check.mjs`: assert the editor shows the first example's source text and JSON output renders. Screenshot-confirm the ComboBox switches examples.

- [ ] **Step 4: Commit** `feat(demos): playground page (editor + corpus picker)`.

---

## Task 5: Gallery page (use case 2 surface)

`GalleryVM` lists the corpus grouped, each card showing title + tags + a live pass/fail badge from `verifyExample` run in-browser; clicking a card opens it in the Playground.

**Files:**
- Rewrite: `app/src/pages/gallery/gallery-vm.ts`
- Create: `app/src/pages/gallery/gallery-card-vm.ts`
- Create: `app/src/pages/gallery/gallery.mu`
- Modify: `app/src/app-vm.ts` (finalize `openInPlayground(entry: CorpusEntry)` typing; pass `AppVM` into `GalleryVM` so cards can navigate)

- [ ] **Step 1: `gallery-card-vm.ts`** — wraps a `CorpusEntry`: `Title`, `Tags` (joined string), `Badge` ("pass"/"FAIL" via `verifyExample(entry).status`), and an `Open` command calling back into `AppVM.openInPlayground(entry)`.

```ts
import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { verifyExample } from "../../../../shared/verify.js";

export class GalleryCardVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(GalleryCardVM, "Title", "", MetaData.None);
  static TagsKey = MuralBase.RegisterProperty<string>(GalleryCardVM, "Tags", "", MetaData.None);
  static BadgeKey = MuralBase.RegisterProperty<string>(GalleryCardVM, "Badge", "", MetaData.None);
  static OpenKey = MuralBase.RegisterProperty<ICommand | undefined>(GalleryCardVM, "Open", undefined, MetaData.None);
  get Title(): string { return this.get_property_value(GalleryCardVM.TitleKey); }
  get Tags(): string { return this.get_property_value(GalleryCardVM.TagsKey); }
  get Badge(): string { return this.get_property_value(GalleryCardVM.BadgeKey); }
  get Open(): ICommand | undefined { return this.get_property_value(GalleryCardVM.OpenKey); }
  constructor(entry: CorpusEntry, onOpen: (e: CorpusEntry) => void) {
    super();
    this.set_property_value(GalleryCardVM.TitleKey, entry.manifest.title);
    this.set_property_value(GalleryCardVM.TagsKey, entry.manifest.tags.join(", "));
    this.set_property_value(GalleryCardVM.BadgeKey, verifyExample(entry).status === "pass" ? "pass" : "FAIL");
    this.set_property_value(GalleryCardVM.OpenKey, new RelayCommand(() => onOpen(entry)));
  }
}
```

- [ ] **Step 2: `gallery-vm.ts`** — builds `Cards: GalleryCardVM[]` from `CORPUS`, wired to `appVM.openInPlayground`. Takes `AppVM` in its constructor (update `AppVM` to construct `new GalleryVM(this)`).

- [ ] **Step 3: `gallery.mu`** — `ListBox [ Items = $Cards ]` with a `DataTemplate [DataType = GalleryCardVM]`: a `Border` (clickable via the `Open` command on a `Button` wrapping the card, or a card `Button`) showing Title, Tags, and a colored Badge `TextBlock`.

- [ ] **Step 4: Build + verify.** Assert card titles + badges render (`texts` includes `"pass"` and example titles). Click a card via the harness and assert navigation to the playground shows that example's source.

- [ ] **Step 5: Commit** `feat(demos): gallery page (corpus cards + live badges + open-in-playground)`.

---

## Task 6: Docs page (use case 4)

`DocsVM` renders the corpus ordered by `group` + `order`; each section is the manifest's markdown `narrative` (as text) followed by a read-only `ExampleRunnerVM`.

**Files:**
- Rewrite: `app/src/pages/docs/docs-vm.ts`
- Create: `app/src/pages/docs/docs-section-vm.ts`
- Create: `app/src/pages/docs/docs.mu`

- [ ] **Step 1: `docs-section-vm.ts`** — `{ Heading, Narrative, Runner: ExampleRunnerVM }`; constructs a runner with `Editable = false` and `load(entry)`. (Narrative is shown as plain text; full markdown rendering is out of scope for the text phase — render the raw narrative string in a wrapped `TextBlock`.)

- [ ] **Step 2: `docs-vm.ts`** — `Sections: DocsSectionVM[]` built from `byGroup(CORPUS)` flattened in group+order, one section per example.

- [ ] **Step 3: `docs.mu`** — a vertical `ScrollViewer` over an `ItemsControl [ Items = $Sections ]` with a `DataTemplate [DataType = DocsSectionVM]`: heading `TextBlock` (Bold) + narrative `TextBlock` (TextWrapping = Wrap) + `ContentControl [ Content = $Runner ]`.

- [ ] **Step 4: Build + verify.** Assert section headings + at least one narrative substring + emitted JSON render; confirm the runner is read-only (editing does nothing) via a harness type attempt.

- [ ] **Step 5: Commit** `feat(demos): docs showcase page (narrative + read-only runners)`.

---

## Task 7: Root wiring, scripts & docs

Wire repo-root scripts, keep the package boundary, and document the dev loop.

**Files:**
- Modify: root `package.json` (scripts only)
- Modify: `app/README.md` (status → full app; dev loop)

- [ ] **Step 1: Add root scripts** (delegating into `app/`; `app:*` require the repo `dist` built first):

```json
"app:build": "npm run build && npm --prefix app run build",
"app:dev": "npm --prefix app run dev",
"app:verify": "node app/src/ui-verify/render-check.mjs"
```
> `app:build` chains the repo `npm run build` so the `@pragmatic-tech-ai/todl` → `../dist` alias resolves against fresh output.

- [ ] **Step 2: Confirm the package boundary** — `npm pack --dry-run` still lists only `dist/**` + `README.md`; `app/` absent. (`app/` is not in `files`; `app/node_modules`/`app/dist` are git-ignored.)

- [ ] **Step 3: Full green pass** — `npm run test:corpus` (Phase 1 + new `compile-for-display` test) and `npm test` (existing `src/**`) both clean. `npm run app:build` succeeds.

- [ ] **Step 4: Update `app/README.md`** — status to "full app"; document the three pages and the `npm run app:dev` / `app:build` / `app:verify` loop, and the Edge-channel render harness.

- [ ] **Step 5: Commit** `chore(demos): wire app scripts + docs for the Mural app`.

---

## Self-Review

**Spec coverage** (§ "The Mural app"):
- Playground (use case 1) → Task 4 (editor + live compile + text panels) + Task 3 (runner). ✓
- Gallery (use case 2 surface) → Task 5 (cards + live badges + open). ✓
- Docs/showcase (use case 4) → Task 6 (narrative + read-only runner). ✓
- Shared `ExampleRunnerVM` embedded by all three → Task 3, reused in 4/5/6. ✓
- Shell + nav (registry-style) → Task 1 (`AppVM` + `shell.mu`); simpler single-`AppVM` navigation replaces the demo's DI `NavigationService` (deviation, noted). ✓
- Text output now, graph diagram later → panels are text; **Phase 3** adds the `Diagram` view + docs static-export. ✓
- Consumes the same corpus + verify → Tasks 2–6 import `shared/` + `examples/corpus.generated`. ✓
- Package boundary → Task 7 Step 2. ✓

**Placeholder scan:** No `TBD`/vague steps. Two explicit implementer decisions are called out and resolved inline (the `ExampleRefVM` picker wrapper in Task 4; the provenance-vs-prelude-exclusion node selection in Task 2) rather than deferred.

**Type consistency:** `ExampleRunnerVM`, `AppVM`, `GalleryCardVM`, `DiagnosticVM`, `DisplayResult`, `compileForDisplay`, `CorpusEntry` are defined once and referenced by the same names/signatures across tasks. `AppVM.openInPlayground(entry: CorpusEntry)` is stubbed in Task 1 and finalized in Task 5 (called out in both).

**Open risks (verify during execution, not assumed):**
1. **`.mu` expression bindings** (`{{ !$Editable }}`): if the compiler rejects the negation or `{{ }}` form, add a derived `IsReadOnly` DP on `ExampleRunnerVM` instead (flagged in Task 3 Step 3).
2. **MuralBase VMs in node**: VM logic is validated via the browser render harness, not node unit tests, since MuralBase may need browser globals. Only the pure `shared/compile-for-display` gets a node test. If MuralBase instantiates cleanly in node, add light VM tests opportunistically.
3. **`setTimeout` debounce in a VM**: fine in the browser; if a VM is ever unit-tested in node, the timer must be injectable — not needed for the text phase.
4. **ComboBox/ListBox binding shapes**: confirm `Items` + `SelectedItem` two-way against the widget-API notes; adjust `DisplayMemberPath` vs. item-template as needed (Task 4/5).
