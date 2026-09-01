# TODL Demos — Phase 4 Implementation Plan (playground power features)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the playground into a real tool via four independent features: full pipeline-stage tabs (Tokens→AST→Model→Diagnostics→JSON→Graph), shareable URL-hash permalinks, a live "vs golden" chip, and JSON download/copy.

**Architecture:** Same discipline as Phases 1–3 — pure logic in `shared/` (node-tested), thin Mural/DOM consumers in `app/`. Three new pure modules (`compile-stages`, `permalink`, `golden-compare`) drive the UI; the stage tabs and chip reuse the deterministic normalize path already shared by `verify`/`compile-for-display`, so what the playground shows is what the tests assert. No new runtime dependencies.

**Tech Stack:** todl compiler public stage API (`tokenize`, `parse`, `load`, `check`, `toJSONOwn`); Mural 0.45 `/basic` (`Button`, `ScrollViewer`, `TextBlock`, `Visibility` DPs), the Phase-3 graph `Canvas`; browser `TextEncoder`/`Blob`/`navigator.clipboard`; Playwright + system Edge for UI verification.

**Spec:** `docs/superpowers/specs/2026-09-01-todl-demos-phase4-design.md`

## Global Constraints

- **`shared/` stays pure** — compiler + plain TS only; no Mural, no DOM (no `window`/`Blob`/`navigator`). Permalink's base64 must run under node (for its unit test) and the browser — use a `TextEncoder`-based base64url (no `Buffer`, no `btoa`).
- **All Mural/DOM code stays in `app/`.** `window`/`location` access is isolated in `app/src/pages/playground/permalink-sync.ts`; `Blob`/`clipboard` in `app/src/components/example-runner/download.ts`.
- **No expression bindings in `.mu`.** Panel/tab visibility uses `Visibility`-typed DPs set by a VM method (the Phase-3 `setView` convention). Editor read-only uses the existing `ReadOnly` boolean DP.
- **Reuse, don't fork, the compile path.** Stage Model/Diagnostics/JSON come from `compileForDisplay` (Phase 2); labels from `nodeLabel` (Phase 3); golden compare from `normalize` (Phase 1). Only Tokens/AST add new compiler calls (`tokenize`/`parse`).
- **Determinism.** `compileStages` seeds one `DeterministicIdGenerator` per call (inside `compileForDisplay`); tokens/AST are id-independent; permalink + golden output are byte-stable.
- **`app/` stays out of the published package** (`files` unchanged). **Build order:** `npm run app:build` chains the repo `npm run build` so the `../dist` alias resolves.
- **UI verification** reuses the committed harness (`vite build` → `vite preview --port 4319 --strictPort` → `node app/src/ui-verify/render-check.mjs [url] [--click "<label>"]`), asserting SVG `<text>` + no `pageerror`.

## File Structure

```
shared/
  compile-stages.ts               # NEW pure: source → {tokens, astText, modelRows, edgeRows, diagnostics, document}
  permalink.ts                    # NEW pure: encodeState/decodeState (base64url of source)
  golden-compare.ts               # NEW pure: compareToGolden(source, golden) → {matches, summary}
  tests/{compile-stages,permalink,golden-compare}.test.ts
app/
  src/components/example-runner/
    example-runner-vm.ts           # MODIFY: 6-stage tabs + Download/Copy commands
    example-runner.mu              # MODIFY: tab strip + 6 visibility-gated panes + output header buttons
    download.ts                    # NEW: downloadText / copyText (DOM helpers)
  src/pages/playground/
    playground-vm.ts               # MODIFY: permalink seed + write; golden chip
    playground.mu                  # MODIFY: Copy-link button + golden chip
    permalink-sync.ts              # NEW: window/location + clipboard seam
  README.md                        # MODIFY: document Phase 4
docs/superpowers/specs/2026-09-01-todl-demos-app-design.md  # MODIFY: note Phase 4
```

## Interfaces produced (referenced across tasks)

- `shared/compile-stages.ts`:
  ```ts
  export interface TokenRow { kind: string; value: string; line: number; column: number }
  export interface ModelRow { id: string; tier: string; typeOf: string; label: string }
  export interface StageResult {
    tokens: TokenRow[]; astText: string;
    modelRows: ModelRow[]; edgeRows: { kind: string; from: string; to: string }[];
    diagnostics: GoldenDiagnostic[]; document: TodlDocument;
  }
  export function compileStages(source: ExampleSource): StageResult
  ```
- `shared/permalink.ts`: `encodeState(source: string): string` (returns `"s=<b64url>"`); `decodeState(hash: string): { source: string } | null`.
- `shared/golden-compare.ts`: `compareToGolden(source: ExampleSource, golden: Golden): { matches: boolean; summary: string }`.
- `app/.../download.ts`: `downloadText(filename: string, text: string): void`; `copyText(text: string): void`.
- `app/.../permalink-sync.ts`: `readSourceFromHash(): string | null`; `writeSourceToHash(source: string): void`; `copyCurrentLink(): void`.

---

## Task 1: `shared/compile-stages.ts` — pure full-pipeline compile

Run all six stages over one editor source and return renderable data. Tokens/AST are new (`tokenize`/`parse`); Model/Diagnostics/JSON reuse `compileForDisplay`.

**Files:**
- Create: `shared/compile-stages.ts`
- Test: `shared/tests/compile-stages.test.ts`

**Interfaces:**
- Consumes: `tokenize`, `parse` (+ `TodlDocument`) from `@pragmatic-tech-ai/todl`; `compileForDisplay` (Phase 2); `nodeLabel` (Phase 3); `ExampleSource`, `GoldenDiagnostic` (`shared/corpus-types`).
- Produces: `compileStages`, `StageResult`, `TokenRow`, `ModelRow`.

- [ ] **Step 1: Write the failing test** `shared/tests/compile-stages.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileStages } from "../compile-stages.js";

const SRC = { name: "m.todl", text:
  `namespace app { concept Component { label : string; } model M : app { Component c { label = "x"; } } }` };

test("tokens are extracted with kind/value/position", () => {
  const r = compileStages(SRC);
  assert.ok(r.tokens.length > 0);
  assert.ok(r.tokens.some((t) => t.value === "concept"));
  for (const t of r.tokens) { assert.equal(typeof t.line, "number"); assert.ok(t.kind.length > 0); }
});

test("astText reflects the namespace path and a concept name", () => {
  const r = compileStages(SRC);
  assert.ok(r.astText.includes("app"), "namespace path");
  assert.ok(r.astText.includes("Component"), "concept name");
  assert.ok(!/\bspan\b/i.test(r.astText), "span noise is stripped");
});

test("model rows line up with the emitted document nodes", () => {
  const r = compileStages(SRC);
  assert.equal(r.modelRows.length, r.document.nodes.length);
  assert.ok(r.modelRows.every((row) => row.label.length > 0));
});

test("a broken source yields a parse message in astText and does not throw", () => {
  const r = compileStages({ name: "m.todl", text: "namespace app { concept @@@ }" });
  assert.ok(r.astText.length > 0);
  assert.ok(r.tokens.length > 0); // tokenizing still works up to the bad char or reports it
});

test("deterministic across runs", () => {
  assert.deepEqual(compileStages(SRC), compileStages(SRC));
});
```

- [ ] **Step 2: Run → FAIL** (`npx tsx --conditions=development --test "shared/tests/compile-stages.test.ts"`).

- [ ] **Step 3: Write `shared/compile-stages.ts`**

```ts
import { tokenize, parse, type TodlDocument } from "@pragmatic-tech-ai/todl";
import type { ExampleSource, GoldenDiagnostic } from "./corpus-types.js";
import { compileForDisplay } from "./compile-for-display.js";
import { nodeLabel } from "./graph-layout.js";

export interface TokenRow { kind: string; value: string; line: number; column: number }
export interface ModelRow { id: string; tier: string; typeOf: string; label: string }
export interface StageResult {
  tokens: TokenRow[]; astText: string;
  modelRows: ModelRow[]; edgeRows: { kind: string; from: string; to: string }[];
  diagnostics: GoldenDiagnostic[]; document: TodlDocument;
}

// Numeric AST enums aren't re-exported from the package; inline the names so the
// tree reads well. (DeclKind / ValueKind from parse/ast.)
const DECL = ["Primitive","Taxonomy","Viewpoint","Concept","Instance","Model","Annotation","Package","Operator"];
const VALUE = ["String","Name","List","Composite","Boolean","Object","Edge"];

/** Generic indented AST outline: header per object (kind-name + salient scalars),
 *  recursing into array/object children. Span keys are dropped as noise. */
function formatAst(node: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(node)) return node.map((n) => formatAst(n, indent)).join("\n");
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const kind = typeof o.kind === "number"
      ? (o.declarations !== undefined ? "Namespace" : DECL[o.kind] ?? VALUE[o.kind] ?? `#${o.kind}`)
      : undefined;
    const scalars = Object.entries(o)
      .filter(([k, v]) => !/span/i.test(k) && k !== "kind" && (typeof v === "string" || typeof v === "boolean") && String(v).length)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    const head = `${pad}${kind ?? "Node"}${scalars ? " " + scalars : ""}`;
    const kids = Object.entries(o)
      .filter(([k, v]) => !/span/i.test(k) && (Array.isArray(v) || (v && typeof v === "object")))
      .map(([, v]) => formatAst(v, indent + 1)).filter((s) => s.length);
    return [head, ...kids].join("\n");
  }
  return "";
}

export function compileStages(source: ExampleSource): StageResult {
  const tokens: TokenRow[] = tokenize(source.text).map((t) => ({ kind: t.kind, value: t.value, line: t.line, column: t.column }));
  const parsed = parse(source.text, source.name);
  const astText = parsed.diagnostics.length
    ? `parse: ${parsed.diagnostics[0].message}\n\n${formatAst(parsed.namespace)}`
    : formatAst(parsed.namespace);
  const display = compileForDisplay([source]);
  const byId = new Map(display.document.nodes.map((n) => [n.id, n]));
  const modelRows: ModelRow[] = display.document.nodes.map((n) => ({
    id: String(n.id), tier: n.tier, typeOf: String(n.typeOf), label: nodeLabel(n),
  }));
  const edgeRows = display.document.edges.map((e) => ({ kind: e.kind, from: String(e.from), to: String(e.to) }));
  void byId;
  return { tokens, astText, modelRows, edgeRows, diagnostics: display.diagnostics, document: display.document };
}
```
> `parse` may still populate `namespace` on partial input; the diagnostic prefix makes failures legible. `formatAst`'s Namespace detection (`declarations !== undefined`) handles the root, whose numeric `kind` collides with `DeclKind.Primitive` (0). Verify the AST assertions in Step 4; if the root prints as "Primitive", the `declarations` guard fixes it (already applied).

- [ ] **Step 4: Run → PASS.** All five tests green.

- [ ] **Step 5: Commit** `feat(demos): pure full-pipeline compile-stages (tokens/AST/model/diag/json)`.

---

## Task 2: Stage tabs in `ExampleRunnerVM` + `.mu`

Replace the JSON/Graph two-button toggle with a six-tab strip. Diagnostics moves into its own tab; Status stays above.

**Files:**
- Modify: `app/src/components/example-runner/example-runner-vm.ts`
- Modify: `app/src/components/example-runner/example-runner.mu`

**Interfaces:**
- Consumes: `compileStages` (Task 1); existing `Graph` (Phase 3), `Diagnostics` list.
- Produces: `ExampleRunnerVM` gains `SelectedStage`, `TokensText`, `AstText`, `ModelText`, six `*Visibility: Visibility` DPs, and `ShowTokens…ShowGraph` commands.

- [ ] **Step 1: Extend `ExampleRunnerVM`.** Add DPs + accessors for `TokensText`/`AstText`/`ModelText` (strings) and six `Visibility` DPs (`TokensVisibility`, `AstVisibility`, `ModelVisibility`, `DiagVisibility`, `JsonVisibility` (exists — reuse), `GraphVisibility` (exists — reuse)). Add six commands each calling a private `setStage`:

```ts
import { compileStages } from "../../../../shared/compile-stages.js";
// DPs (pattern as existing): SelectedStageKey:string="json", TokensTextKey, AstTextKey, ModelTextKey,
// TokensVisibilityKey, AstVisibilityKey, ModelVisibilityKey, DiagVisibilityKey (Visibility),
// ShowTokensKey..ShowGraphKey (ICommand).

private setStage(stage: "tokens" | "ast" | "model" | "diag" | "json" | "graph"): void {
  const v = (s: string) => (s === stage ? Visibility.Visible : Visibility.Collapsed);
  this.set_property_value(ExampleRunnerVM.TokensVisibilityKey, v("tokens"));
  this.set_property_value(ExampleRunnerVM.AstVisibilityKey, v("ast"));
  this.set_property_value(ExampleRunnerVM.ModelVisibilityKey, v("model"));
  this.set_property_value(ExampleRunnerVM.DiagVisibilityKey, v("diag"));
  this.set_property_value(ExampleRunnerVM.JsonVisibilityKey, v("json"));
  this.set_property_value(ExampleRunnerVM.GraphVisibilityKey, v("graph"));
  this.set_property_value(ExampleRunnerVM.SelectedStageKey, stage);
}
```
Default stage `"json"` (JSON visible, others collapsed) so existing behavior/tests hold. Wire the six commands in the constructor.

- [ ] **Step 2: Build stage strings in `compile()`.** Replace the current graph/JSON assignment block with a single `compileStages` call:

```ts
const stages = compileStages({ name: this.fileName, text: this.Source });
this.set_property_value(ExampleRunnerVM.DiagnosticsKey, stages.diagnostics.map((d) => new DiagnosticVM(d)));
this.set_property_value(ExampleRunnerVM.StatusKey, stages.diagnostics.some((d) => d.severity === "error") ? `${stages.diagnostics.length} problem(s)` : "OK");
this.set_property_value(ExampleRunnerVM.JsonKey, JSON.stringify(stages.document, null, 2));
this.set_property_value(ExampleRunnerVM.TokensTextKey, stages.tokens.map((t) => `${t.line}:${t.column}  ${t.kind.padEnd(12)} ${t.value}`).join("\n"));
this.set_property_value(ExampleRunnerVM.AstTextKey, stages.astText);
this.set_property_value(ExampleRunnerVM.ModelTextKey,
  [...stages.modelRows.map((r) => `${r.id}  ${r.tier}  ${r.label}`), "",
   ...stages.edgeRows.map((e) => `${e.from} --${e.kind}--> ${e.to}`)].join("\n"));
this.set_property_value(ExampleRunnerVM.GraphKey, buildGraphCanvas(layoutGraph(stages.document)));
```
(Keeps `compileForDisplay` inside `compileStages`; remove the now-duplicate direct import if unused.)

- [ ] **Step 3: Update `example-runner.mu`.** Replace the `StackPanel` toggle + the two `ScrollViewer`s with a six-button strip and six visibility-gated panes:

```
StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,6) ] {
    Button [ Command = $ShowTokens, Margin = (0,0,4,0) ] { TextBlock [ Text = "Tokens" ] }
    Button [ Command = $ShowAst,    Margin = (0,0,4,0) ] { TextBlock [ Text = "AST" ] }
    Button [ Command = $ShowModel,  Margin = (0,0,4,0) ] { TextBlock [ Text = "Model" ] }
    Button [ Command = $ShowDiag,   Margin = (0,0,4,0) ] { TextBlock [ Text = "Diagnostics" ] }
    Button [ Command = $ShowJson,   Margin = (0,0,4,0) ] { TextBlock [ Text = "JSON" ] }
    Button [ Command = $ShowGraph ]                      { TextBlock [ Text = "Graph" ] }
}
ScrollViewer [ Visibility = $TokensVisibility ] { TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $TokensText ] }
ScrollViewer [ Visibility = $AstVisibility ]    { TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $AstText ] }
ScrollViewer [ Visibility = $ModelVisibility ]  { TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $ModelText ] }
ScrollViewer [ Visibility = $DiagVisibility ]   { ListBox [ Items = $Diagnostics ] }
ScrollViewer [ Visibility = $JsonVisibility ]   { TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $Json ] }
ScrollViewer [ Visibility = $GraphVisibility ]  { ContentControl [ Content = $Graph ] }
```
> Remove the always-on Diagnostics `ListBox` that used to sit above the toggle (it's now the Diagnostics tab). Keep the `Status` TextBlock on top. If the DockPanel stacks the panes oddly, wrap the six panes in a `Grid` (single cell) so they overlay — the collapsed ones take no space (Phase-3 verified `Visibility` collapses to zero rect).

- [ ] **Step 4: Build + verify each tab.** `vite build` → preview → for each of Tokens/AST/Model/Diagnostics/Graph, run the harness with `--click "<label>"` and assert a stage-specific string appears in SVG `<text>`: `"concept"`/a `TokenKind` (Tokens), `"Component"` or the namespace path (AST), a node id/label (Model), a node label (Graph), `"nodes"` (JSON default). No `errors`. Screenshot-confirm the strip switches cleanly.

- [ ] **Step 5: Commit** `feat(demos): full pipeline-stage tabs in the example runner`.

---

## Task 3: `shared/permalink.ts` — pure URL-hash state

Encode/decode the editor source as a base64url URL-hash param, runtime-agnostic (node + browser).

**Files:**
- Create: `shared/permalink.ts`
- Test: `shared/tests/permalink.test.ts`

**Interfaces:**
- Produces: `encodeState(source): string`; `decodeState(hash): { source } | null`.

- [ ] **Step 1: Write the failing test** `shared/tests/permalink.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeState, decodeState } from "../permalink.js";

test("round-trips ASCII source", () => {
  const s = `namespace app { concept C { label : string; } }`;
  assert.equal(decodeState("#" + encodeState(s))!.source, s);
});
test("round-trips unicode", () => {
  const s = `// café ☕ — naïve\nnamespace app { }`;
  assert.equal(decodeState(encodeState(s))!.source, s);
});
test("malformed hash → null", () => {
  assert.equal(decodeState("#nope=1"), null);
  assert.equal(decodeState(""), null);
  assert.equal(decodeState("#s=@@@notbase64@@@"), null);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `shared/permalink.ts`** (TextEncoder-based base64url — no `Buffer`/`btoa`):

```ts
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToB64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : "";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "";
  }
  return out;
}
function b64urlToBytes(s: string): Uint8Array | null {
  const lut = new Map([...B64].map((c, i) => [c, i]));
  const out: number[] = [];
  let bits = 0, acc = 0;
  for (const ch of s) {
    const v = lut.get(ch);
    if (v === undefined) return null;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

export function encodeState(source: string): string {
  return "s=" + bytesToB64url(new TextEncoder().encode(source));
}
export function decodeState(hash: string): { source: string } | null {
  const m = hash.replace(/^[#?]/, "").split("&").find((p) => p.startsWith("s="));
  if (!m) return null;
  const bytes = b64urlToBytes(m.slice(2));
  if (!bytes) return null;
  try { return { source: new TextDecoder().decode(bytes) }; } catch { return null; }
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(demos): pure base64url permalink state (share/restore playground)`.

---

## Task 4: Permalink sync in the Playground + "Copy link"

Seed the editor from the URL hash on load; write the hash (debounced) on edit; a Copy-link button.

**Files:**
- Create: `app/src/pages/playground/permalink-sync.ts`
- Modify: `app/src/pages/playground/playground-vm.ts`
- Modify: `app/src/pages/playground/playground.mu`

**Interfaces:**
- Consumes: `encodeState`/`decodeState` (Task 3).
- Produces: `readSourceFromHash()`, `writeSourceToHash(source)`, `copyCurrentLink()`.

- [ ] **Step 1: Write `permalink-sync.ts`** (the only `window` seam):

```ts
import { encodeState, decodeState } from "../../../../shared/permalink.js";
export function readSourceFromHash(): string | null {
  return decodeState(typeof window === "undefined" ? "" : window.location.hash)?.source ?? null;
}
export function writeSourceToHash(source: string): void {
  if (typeof window !== "undefined") window.location.hash = encodeState(source);
}
export function copyCurrentLink(): void {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof window !== "undefined")
    void navigator.clipboard.writeText(window.location.href);
}
```

- [ ] **Step 2: Wire `PlaygroundVM`.** In the constructor, prefer a hashed source over the first-example seed; add a debounced hash write on runner `Source` change; add a `CopyLink` command:

```ts
// after constructing the runner:
const hashed = readSourceFromHash();
if (hashed !== null) { runner.Source = hashed; }        // triggers debounced compile
else if (CORPUS[0]) runner.load(CORPUS[0]);
let timer: ReturnType<typeof setTimeout> | undefined;
runner.AddPropertyChangedListener(ExampleRunnerVM.SourceKey, () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => writeSourceToHash(runner.Source), 400);
});
this.set_property_value(PlaygroundVM.CopyLinkKey, new RelayCommand(() => copyCurrentLink()));
```
(Register `CopyLinkKey: ICommand`. Remove the old unconditional `runner.load(CORPUS[0])` if it lived elsewhere; keep the example-picker `Selected` listener — selecting an example still calls `runner.load`, which updates `Source` and thus the hash.)

- [ ] **Step 3: Add the button** to `playground.mu` next to the example picker: `Button [ Command = $CopyLink ] { TextBlock [ Text = "Copy link" ] }`.

- [ ] **Step 4: Build + verify.** (a) `render-check.mjs http://localhost:4319/#s=<enc>` where `<enc>` is `encodeState` of a distinctive source (compute it inline in the harness or a one-off node script) — assert the editor shows that source. (b) Default load (no hash) still shows the first example. No `errors`.

- [ ] **Step 5: Commit** `feat(demos): playground permalinks (hash seed + debounced write + copy link)`.

---

## Task 5: Live "vs golden" chip

When a corpus example is loaded, show whether the live source still matches its committed golden.

**Files:**
- Create: `shared/golden-compare.ts`
- Test: `shared/tests/golden-compare.test.ts`
- Modify: `app/src/pages/playground/playground-vm.ts`
- Modify: `app/src/pages/playground/playground.mu`

**Interfaces:**
- Consumes: `compileForDisplay` (Phase 2); `Golden`, `ExampleSource` (`shared/corpus-types`).
- Produces: `compareToGolden(source, golden) → { matches, summary }`.

- [ ] **Step 1: Write the failing test** `shared/tests/golden-compare.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareToGolden } from "../golden-compare.js";
import { CORPUS } from "../../examples/corpus.generated.js";

test("an unedited example matches its golden", () => {
  const e = CORPUS.find((x) => x.sources.length === 1)!;
  const r = compareToGolden({ name: e.sources[0].name, text: e.sources[0].text }, e.golden);
  assert.equal(r.matches, true);
});
test("a mutated source diverges", () => {
  const e = CORPUS.find((x) => x.sources.length === 1)!;
  const r = compareToGolden({ name: e.sources[0].name, text: e.sources[0].text + "\nnamespace extra { }" }, e.golden);
  assert.equal(r.matches, false);
  assert.ok(r.summary.length > 0);
});
```
> Pick a single-source example so the compare (which compiles one editor source) is apples-to-apples with the golden. Multi-file goldens are out of chip scope (documented).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write `shared/golden-compare.ts`**

```ts
import type { ExampleSource, Golden } from "./corpus-types.js";
import { compileForDisplay } from "./compile-for-display.js";

export function compareToGolden(source: ExampleSource, golden: Golden): { matches: boolean; summary: string } {
  const live = compileForDisplay([source]);
  const matches = JSON.stringify({ d: live.diagnostics, n: live.document }) === JSON.stringify({ d: golden.diagnostics, n: golden.document });
  if (matches) return { matches: true, summary: "matches golden" };
  const dn = live.document.nodes.length - golden.document.nodes.length;
  const dd = live.diagnostics.length - golden.diagnostics.length;
  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return { matches: false, summary: `diverged (nodes ${fmt(dn)}, diagnostics ${fmt(dd)})` };
}
```
> Both sides are already canonical (`compileForDisplay` and the committed golden use the same normalize), so a stable-key `JSON.stringify` compare is sound.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Wire the chip.** In `PlaygroundVM`: track the loaded `CorpusEntry` (`this.loadedEntry`), set on `load()`/picker-select, cleared when a hashed source seeds the editor. Add `GoldenStatus: string` + `GoldenVisibility: Visibility` DPs; recompute on runner `Source` change:

```ts
private refreshGolden(): void {
  const e = this.loadedEntry;
  if (!e || e.sources.length !== 1) { this.set_property_value(PlaygroundVM.GoldenVisibilityKey, Visibility.Collapsed); return; }
  const c = compareToGolden({ name: e.sources[0].name, text: this.Runner.Source }, e.golden);
  this.set_property_value(PlaygroundVM.GoldenStatusKey, c.matches ? "✓ matches golden" : "✗ " + c.summary);
  this.set_property_value(PlaygroundVM.GoldenVisibilityKey, Visibility.Visible);
}
```
Call `refreshGolden()` from the same debounced `Source` listener (after the hash write). Add the chip to `playground.mu`: `TextBlock [ Visibility = $GoldenVisibility, Text = $GoldenStatus, Margin = (8,0,0,0) ]`.

- [ ] **Step 6: Build + verify.** Load default (first example) → chip reads "✓ matches golden". Screenshot-confirm; harness-assert `"matches golden"` present. Then (optional) type via harness and assert it flips. No `errors`.

- [ ] **Step 7: Commit** `feat(demos): live vs-golden chip in the playground`.

---

## Task 6: Download / copy emitted JSON

Output-header buttons: download the emitted JSON as a file; copy it to the clipboard.

**Files:**
- Create: `app/src/components/example-runner/download.ts`
- Modify: `app/src/components/example-runner/example-runner-vm.ts`
- Modify: `app/src/components/example-runner/example-runner.mu`

**Interfaces:**
- Produces: `downloadText(filename, text)`, `copyText(text)`; `ExampleRunnerVM` gains `Download`/`Copy` commands.

- [ ] **Step 1: Write `download.ts`** (DOM seam):

```ts
export function downloadText(filename: string, text: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
export function copyText(text: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard) void navigator.clipboard.writeText(text);
}
```

- [ ] **Step 2: Add commands** to `ExampleRunnerVM` (register `DownloadKey`/`CopyKey: ICommand`; wire in constructor):

```ts
this.set_property_value(ExampleRunnerVM.DownloadKey, new RelayCommand(() => downloadText(this.fileName.replace(/\.todl$/, "") + ".json", this.Json)));
this.set_property_value(ExampleRunnerVM.CopyKey, new RelayCommand(() => copyText(this.Json)));
```

- [ ] **Step 3: Add buttons** to the output header in `example-runner.mu` (append to the tab-strip `StackPanel` or a small header row): `Button [ Command = $Copy ] { TextBlock [ Text = "Copy JSON" ] }` and `Button [ Command = $Download ] { TextBlock [ Text = "Download" ] }`.

- [ ] **Step 4: Build + verify.** Assert the buttons render (harness `texts` includes "Download"/"Copy JSON"); no `errors`. (Actual file save / clipboard can't be asserted headlessly — verify the commands are wired by clicking without error.)

- [ ] **Step 5: Commit** `feat(demos): download + copy emitted JSON from the runner`.

---

## Task 7: Docs, spec status & full green pass

**Files:**
- Modify: `app/README.md`
- Modify: `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md`

- [ ] **Step 1: Update `app/README.md`** — describe the playground's stage tabs (Tokens→…→Graph), permalinks, the vs-golden chip, and download/copy.
- [ ] **Step 2: Note Phase 4** in the parent spec's "Phasing" (append a Phase 4 line marked DONE with the four features).
- [ ] **Step 3: Full green pass** — `npm run test:corpus` (Phase 1–4 shared tests), `npm test`, `npm run app:build` all clean. Optionally `npm run app:verify`.
- [ ] **Step 4: Commit** `docs(demos): document playground power features; note Phase 4`.

---

## Self-Review

**Spec coverage:**
- Stage tabs (full pipeline) → Task 1 (`compile-stages`) + Task 2 (six-tab UI). ✓
- Permalink → Task 3 (`permalink`) + Task 4 (sync + copy). ✓
- Live golden chip → Task 5 (`golden-compare` + chip). ✓
- Download/copy → Task 6. ✓
- Pure/consumer boundary → three pure `shared/` modules (node-tested); all DOM in `permalink-sync.ts`/`download.ts`. ✓
- Determinism / one compile path → stages + chip reuse `compileForDisplay`/`normalize`. ✓
- Package boundary → no `files` change, no new deps. ✓

**Placeholder scan:** No `TBD`/vague steps; every code step has real content. Two execution-time risks flagged with fixes (below).

**Type consistency:** `StageResult`/`TokenRow`/`ModelRow`/`compileStages` (Task 1) consumed by the VM (Task 2); `encodeState`/`decodeState` (Task 3) by `permalink-sync` (Task 4); `compareToGolden` (Task 5) by the chip; `downloadText`/`copyText` (Task 6) by the runner commands. Existing DP names (`JsonVisibility`/`GraphVisibility`/`ReadOnly`/`Graph`/`Diagnostics`/`Json`) are reused with their Phase-2/3 meanings; new DPs follow the same `RegisterProperty` pattern. `ExampleRunnerVM.SourceKey` (Task 4 listener) is the existing key.

**Open risks (verify during execution):**
1. **AST root prints as "Primitive"** (numeric `kind` 0 collides): the `declarations !== undefined` guard in `formatAst` labels the root "Namespace" — confirm via the Task 1 test asserting the namespace path renders.
2. **Six panes in a DockPanel**: if stacking misbehaves, wrap them in a single-cell `Grid` so collapsed panes overlay at zero size (Phase-3 verified `Visibility.Collapsed` → zero rect). Flagged in Task 2 Step 3.
3. **`window`/`navigator` in a VM under a bundler**: all access is guarded (`typeof window !== "undefined"`) and isolated in `permalink-sync.ts`/`download.ts`, so SSR/headless import won't throw; the harness runs in a real browser.
4. **Multi-file goldens vs the chip**: the chip compares one editor source, so it engages only for single-source examples (guarded); multi-file examples collapse the chip. Documented.
