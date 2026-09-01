# TODL Demos — Phase 4 Design: Playground power features

**Date:** 2026-09-01
**Status:** Approved design, ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md` (this is a Phase-4 extension; Phases 1–3 are DONE and pushed)
**Scope:** Turn the playground from a live-compile textbox into a real tool, via four independent features: full pipeline-stage tabs, shareable permalinks, a live "vs golden" chip, and JSON download/copy.

## Goal

The playground currently compiles editor text (300ms-debounced) and shows diagnostics + a JSON/Graph toggle. Phase 4 makes it a genuine exploration + sharing tool:

1. **Pipeline-stage tabs** — show the compiler working, stage by stage: **Tokens → AST → Model → Diagnostics → JSON → Graph**, all from the compiler's already-public stage functions (no compiler changes).
2. **Permalink / share** — encode the editor source in the URL hash so a playground state is bookmarkable and shareable.
3. **Live golden compare** — when a corpus example is loaded, show whether the (possibly edited) source still matches its committed golden.
4. **Download / copy** — download the emitted JSON as a file; copy it to the clipboard.

## Core principle (unchanged)

One corpus, one compile path. Every stage view and the golden chip run through the same deterministic normalize path (`DeterministicIdGenerator` + `normalize`) already used by `shared/verify` and `shared/compile-for-display`, so *what the playground shows is what the tests assert*.

## Boundaries

Same discipline as Phases 1–3: **pure, framework-agnostic logic in `shared/` (node-tested); thin Mural/DOM consumers in `app/`.** No new runtime dependencies. `app/` stays out of the published package; `shared/` imports only the todl compiler.

| Feature | Pure core (`shared/`) | App consumer (`app/`) |
|---|---|---|
| Stage tabs | `compile-stages.ts` | `ExampleRunnerVM` stage DPs + `.mu` tab strip |
| Permalink | `permalink.ts` | `PlaygroundVM` hash read/write (`app/.../permalink-sync.ts`) |
| Golden compare | `golden-compare.ts` | Playground "vs golden" chip |
| Download/copy | (reuses emitted JSON) | `ExampleRunnerVM` `Download`/`Copy` commands |

## Feature 1 — Pipeline-stage tabs (full pipeline)

### Compiler surface (verified, all public exports of `@pragmatic-tech-ai/todl`)
- `tokenize(text: string): Token[]` — `Token = { kind: TokenKind, value, line, column, endLine, endColumn }`.
- `parse(text: string, uri?): { namespace: NamespaceNode, diagnostics }` — recursive-descent AST rooted at a `NamespaceNode`.
- `load(sources, idGen?): { model: Repository, diagnostics, provenance }` — the resolved model.
- `check(sources, idGen?)` + `toJSONOwn(model, ownIds)` — validated diagnostics + emitted `TodlDocument` (already used by `compile-for-display`).

### Design decision — single-source stage input
`tokenize`/`parse` take one source string; `check`/`load` take `SourceFile[]`. The playground already compiles the editor as a single `[{name, text}]`, so **all six stages run over that one source**. Tokens/AST therefore reflect the editor text as one parse unit (a single `namespace` block, the TODL norm); if the text isn't a single namespace, the AST tab surfaces the parse diagnostic rather than throwing. This is faithful ("what the parser sees for this text") and documented in the UI copy.

### `shared/compile-stages.ts` (pure)
```ts
export interface TokenRow { kind: string; value: string; line: number; column: number }
export interface ModelRow { id: string; tier: string; typeOf: string; label: string }
export interface StageResult {
  tokens: TokenRow[];       // from tokenize()
  astText: string;          // pretty-printed AST tree (indented), or the parse error
  modelRows: ModelRow[];    // resolved own-nodes as readable rows
  edgeRows: { kind: string; from: string; to: string }[];
  diagnostics: GoldenDiagnostic[];  // canonical (reused normalize)
  document: TodlDocument;   // emitted own-document (reused compile-for-display)
}
export function compileStages(source: ExampleSource): StageResult
```
- **Tokens** — map `tokenize(text)` to `TokenRow[]` (kind/value/line/column).
- **AST** — `parse(text)`; pretty-print `NamespaceNode` as an indented tree via a small generic recursive walker (`node.kind`/type + salient scalar fields + children). On parse failure, `astText` is the first parse diagnostic message.
- **Model / Diagnostics / JSON** — reuse `compileForDisplay(source)` for the canonical `{diagnostics, document, ok}`; derive `modelRows`/`edgeRows` from `document.nodes`/`document.edges` (label via the Phase-3 `nodeLabel`). This keeps ids/labels identical across the Model, JSON, and Graph tabs.
- Deterministic: single `DeterministicIdGenerator` seeded per call (inside `compileForDisplay`); tokens/AST are id-independent.

### App — `ExampleRunnerVM` + `.mu`
- Replace the JSON/Graph two-button toggle with a **six-tab strip** (Tokens · AST · Model · Diagnostics · JSON · Graph). A `SelectedStage: string` DP + six `Visibility`-typed DPs (`TokensVisibility` … `GraphVisibility`), set by one `setStage(stage)` method (mirrors the Phase-3 `setView` convention — **no expression bindings**).
- `compile()` calls `compileStages` once; stashes `TokensText`/`AstText`/`ModelText`/`Json` (monospace strings) + `Diagnostics` (existing list) + `Graph` (existing Phase-3 canvas).
  - Tokens/Model render as pre-formatted monospace text (built in the VM from the rows — a table is overkill for a demo); AST as monospace text; Graph unchanged.
- Diagnostics and Graph panes reuse the existing widgets; only the JSON pane's neighbors are added.

## Feature 2 — Permalink / share

### `shared/permalink.ts` (pure)
```ts
export function encodeState(source: string): string          // "s=<base64url>"
export function decodeState(hash: string): { source: string } | null
```
- Encode: UTF-8 → base64url (no padding), prefixed `s=`. Unicode-safe (`TextEncoder`/`btoa`-free path usable in node + browser — use `Buffer`-free base64 via a tiny shared encoder, or `btoa(unescape(encodeURIComponent(...)))` guarded for both runtimes). The pure module must run under node for its unit test, so it uses a runtime-agnostic base64 (a small inline implementation over `TextEncoder`/`TextDecoder`, both available in node ≥ 20 and browsers).
- Decode: strip a leading `#`/`?`, find the `s=` param, base64url-decode → source. Malformed → `null`.
- No compression (documented caveat: very long sources make long URLs).

### App — `app/src/pages/playground/permalink-sync.ts` + `PlaygroundVM`
- On `PlaygroundVM` construction: read `window.location.hash`; if `decodeState` yields a source, seed the runner with it (**overrides** the default first-example seed). Else seed the first example as today.
- On runner `Source` change (debounced ~400ms): write `window.location.hash = encodeState(source)`.
- A **"Copy link"** button (near the editor) copies `location.href` to the clipboard.
- `permalink-sync.ts` isolates all `window`/`location` access (keeps `PlaygroundVM` logic testable and the DOM seam in one file).

## Feature 3 — Live golden compare

### `shared/golden-compare.ts` (pure)
```ts
export interface GoldenComparison { matches: boolean; summary: string }
export function compareToGolden(source: ExampleSource, golden: Golden): GoldenComparison
```
- Compile `source` via the same normalize path (`compile-for-display` / `verify`'s normalize), diff the normalized `{diagnostics, document}` against `golden`. `matches` = deep-equal; `summary` = `"matches golden"` or `"diverged (N node / M diag delta)"` (a short human hint, not a full diff — the JSON tab shows detail).
- Reuses the existing `normalize` + a deep-equal; no new diff engine.

### App — Playground chip
- `PlaygroundVM` tracks the currently loaded `CorpusEntry` (if any). When one is loaded, a chip binds to a `GoldenStatus: string` DP recomputed on each compile via `compareToGolden(currentSource, entry.golden)`: **"✓ matches golden"** (green) or **"✗ diverged from golden"** (amber). Hand-typed sessions (no entry) leave the chip blank/collapsed.
- This visibly ties the playground to the regression baseline: edit a passing example, watch it diverge.

## Feature 4 — Download / copy

### App only (`ExampleRunnerVM`)
- `Download` command: build a `Blob` from the emitted JSON string, create an object URL, trigger an `<a download>` click, revoke the URL. Filename `<fileName>.json` (from the loaded example or `playground.todl` → `playground.json`).
- `Copy` command: `navigator.clipboard.writeText(this.Json)`.
- Both live on the output header next to the tab strip. DOM-only; no `shared/` change. (A tiny `app/src/components/example-runner/download.ts` helper isolates the Blob/anchor DOM dance.)

## Data flow

```
editor text ──▶ ExampleRunnerVM.compile()
                     │
                     ├─ compileStages(src) ─▶ Tokens | AST | Model | Diagnostics | JSON | Graph  (tabs)
                     ├─ compareToGolden(src, entry.golden) ─▶ "vs golden" chip   (when a corpus entry is loaded)
                     └─ Json string ─▶ Download / Copy

URL #s=<base64url> ◀──debounced── source change
                  └──on load──▶ decodeState ─▶ seed editor
```

## Testing

- **`shared/tests/`**
  - `compile-stages`: tokens non-empty for valid source; `astText` non-empty and reflects a concept name; `modelRows.length === document.nodes.length`; deterministic across runs; a syntactically broken source yields a parse message in `astText` and does not throw.
  - `permalink`: `decodeState(encodeState(s)).source === s` for ASCII + unicode; malformed hash → `null`; empty hash → `null`.
  - `golden-compare`: an unedited corpus example's joined source `matches` its golden; a mutated source `diverged`.
- **App** (committed Playwright/Edge harness, extended): each tab renders its content on click (a `TokenKind` for Tokens, an AST keyword, a node id for Model, `"nodes"` for JSON, a node label for Graph); permalink round-trips via `page.goto(base + '#s=' + encoded)` seeding the editor; the golden chip shows "matches" for a freshly loaded example; download button present + wired (smoke).
- **Green gates:** `npm run test:corpus` (+ new shared tests), `npm test`, `npm run app:build`.

## Phasing within Phase 4 (each task independently testable)

1. `shared/compile-stages.ts` (pure) + tests.
2. Stage-tabs UI in `ExampleRunnerVM` + `.mu` (six tabs), verified in-browser.
3. `shared/permalink.ts` (pure) + tests.
4. Permalink sync in `PlaygroundVM` (`permalink-sync.ts`) + "Copy link", verified in-browser.
5. `shared/golden-compare.ts` (pure) + tests, and the Playground chip.
6. Download/copy commands + `download.ts` helper.
7. Root docs (`app/README.md`) + spec status + full green pass.

## Open risks / notes

- **AST pretty-print fidelity**: a generic tree walk over `NamespaceNode` may print more or less than ideal; acceptable for a demo. Keep the walker in `shared/` so it's unit-tested against a known source.
- **Multi-namespace editor text**: Tokens always render; AST reflects a single-namespace parse (shows the parse diagnostic otherwise). Documented in UI copy; the semantic tabs (Model/Diag/JSON/Graph) use the full `check()` path and are unaffected.
- **Base64 in two runtimes**: the permalink encoder must work in node (for tests) and the browser; use a runtime-agnostic `TextEncoder`-based base64url (no `Buffer`, no `btoa` assumptions).
- **Clipboard/download permissions**: `navigator.clipboard` may be unavailable in some contexts; guard and no-op gracefully.
