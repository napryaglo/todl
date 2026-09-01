# TODL Tests & Demos Application — Design

**Date:** 2026-09-01
**Status:** Approved design, ready for implementation planning
**Scope:** A tests-and-demos application suite living inside the `@pragmatic-tech-ai/todl`
repo, covering four use cases over a single shared example corpus.

## Goal

Give TODL a runnable showcase that doubles as a regression harness. Four use cases:

1. **Interactive playground** — type `.todl`, live-see diagnostics, the compiled model,
   and emitted JSON.
2. **Example corpus + runner** — a curated library of canonical `.todl` examples, each a
   demo *and* a golden-snapshot regression test.
3. **CLI demo tool** — a command-line app that runs examples, prints pipeline stages, and
   serves as a scriptable CI smoke test.
4. **Docs-driven showcase** — literate documentation where each concept's snippet is a
   verified corpus example.

Delivery split (per the brainstorm):
- **One runnable Mural app** covers use cases 1, 2, 4.
- **A separate CLI** in a dedicated folder covers use case 3.

## Core principle

**One example corpus is the single source of truth.** Every use case is a *consumer* of
it — the playground loads examples, the gallery lists them, the docs narrate them, the CLI
runs them, and the golden tests verify them. There is exactly one compile path
(`check()` → normalize → diff|render), so *the demo you see is the test that guards it*.

## Structural approach (chosen: B — sibling folders, one package)

Leave the existing `src/`, `dist/`, and the `@pragmatic-tech-ai/todl` root package
untouched. Add top-level folders that are **excluded from the published `files` array**, so
the shipped npm package stays lean. This mirrors how Mural hosts its own `demo/` gallery and
reuses TODL's existing `gen:prelude` codegen idiom.

Rejected alternatives:
- **A — npm workspaces monorepo:** moves the entire `src/` tree and rewrites the root
  package. High churn/risk for no present gain. (YAGNI.)
- **C — separate `todl-demos` repo:** contradicts the "within todl repo" requirement.

## Repository layout

```
TODL/
  src/                         # UNCHANGED — the compiler
  scripts/
    gen-prelude.mjs
    gen-corpus.mjs             # NEW — mirrors gen-prelude: examples/ → generated module
  examples/                    # NEW — the corpus (single source of truth)
    <category>/<id>/
      example.todl             # source (or main.todl/base.todl… for multi-file)
      example.json             # manifest: id, title, group, order, tags, narrative, files
      golden.json              # committed expected output (diagnostics + emitted document)
    tests/
      corpus.test.ts           # regression backbone: verifyAll(update:false) must be clean
    corpus.generated.ts        # GENERATED index: id → { manifest, sources, golden }
  shared/                      # NEW — pure, framework-agnostic
    corpus.ts                  # loads corpus.generated.ts; typed accessors
    verify.ts                  # check() an example, normalize, diff against golden
    tests/                     # unit tests for corpus loader, normalizer, diff
  cli/                         # NEW — command-line tool (use case 3)
    package.json               # local; carries the bin, keeps it out of the root package
    tsconfig.json
    src/
      main.ts
      commands/{list,run,test,docs}.ts
      format.ts
  app/                         # NEW — Mural runnable app (use cases 1, 2, 4)
    tsconfig.json              # demo-style: emits .mjs beside .mts
    index.html                 # importmap → mural/dist + todl/dist
    shell/                     # nav rail + registry + NavigationService (à la demo/platform)
    pages/{playground,gallery,docs}/
    components/example-runner/ # ExampleRunnerVM + .mu (editor + live check + output)
```

### Boundaries

- **`shared/`** depends only on the todl compiler. No Mural, no DOM. Imported by CLI (node),
  the app (browser), and the node regression test.
- **`app/`** depends on Mural + `shared/`. Imports the compiler and Mural via each package's
  `development`→`src` export condition under `tsx`; in the browser the importmap points at
  each package's `dist/`, exactly like Mural's demo.
- **`cli/`** depends on node + `shared/` only.
- Root `package.json` gains `gen:corpus`, `test:corpus`, `cli`, and `app:*` scripts, plus
  **Mural as a devDependency** (app-only, never shipped). None of `examples/`, `shared/`,
  `cli/`, `app/` are added to the package `files` array.

## The example corpus

Each example is a folder `examples/<category>/<id>/` with three files.

**`example.todl`** — the source. Multi-file examples (to demo cross-file references, bases,
namespaces) instead hold `main.todl`, `base.todl`, etc.; the manifest lists load order.

**`example.json`** — the manifest:
```json
{
  "id": "taxonomy-bare-resolution",
  "title": "Bare term resolution across a taxonomy",
  "group": "Resolution",
  "order": 30,
  "tags": ["taxonomy", "resolve"],
  "narrative": "A term used bare resolves to a sibling in the same taxonomy…",
  "files": ["taxonomy.todl", "usage.todl"],
  "bases": [],
  "expectClean": true
}
```
- `group` + `order` drive gallery sections and docs sequencing.
- `narrative` is markdown — this is what lets the *same* example power the docs-showcase
  (use case 4). Docs = corpus filtered/ordered by group, narrative rendered above the
  runnable snippet.
- `files` is the load order; `bases` (optional) marks files compiled as already-published
  bases via `checkAgainst` instead of `check`.
- `expectClean` is a fast human-readable intent flag; the authoritative check is the golden.

**`golden.json`** — committed expected output from the compiler, normalized:
```json
{
  "diagnostics": [{ "code": "…", "message": "…", "span": {…} }],
  "document": { "nodes": [ … ], "edges": [ … ] }
}
```
The golden stores the emitted `TodlDocument` (from the existing `emit/json` layer) plus
diagnostics — the stable, serializable surface. **Not** the in-memory `Repository`.

**`corpus.generated.ts`** — produced by `gen-corpus.mjs`, mirroring `gen-prelude.mjs`. It
inlines every example's manifest, source text(s), and golden as string/JSON constants into
one module, so the browser needs no filesystem and no runtime fetch:
```ts
// GENERATED from examples/ by scripts/gen-corpus.mjs — do not edit by hand.
export const CORPUS = [
  { id: "…", manifest: {…}, sources: [{ name: "…", text: "…" }], golden: {…} },
  …
];
```
`shared/corpus.ts` wraps `CORPUS` with typed accessors (`all()`, `byId(id)`,
`byGroup()`, `groups()`). One generated artifact, three consumers.

## The verify layer (`shared/verify.ts`)

One pure function, the heart of use case 2, reused by CLI and node tests alike:

```ts
verifyExample(example, opts?: { update?: boolean }): VerifyResult
verifyAll(corpus, opts?): { passed: number; failed: number; updated: number; results: VerifyResult[] }
```

Flow:
1. Build `SourceFile[]` from `example.sources` in `manifest.files` order.
2. Compile — `check(sources, idGen)` normally, or `checkAgainst(bases, sources, idGen)` when
   the manifest marks `bases`.
3. **Normalize** live output to the golden shape `{ diagnostics, document }`. Normalization
   is the crux — output must be *deterministic* to diff cleanly:
   - Inject a **seeded/counter `IdGenerator`** (the `check`/`checkAgainst` API already accepts
     one) so ids are stable per run instead of Snowflake-random. This affects only the
     demo/verify path — never the real compiler.
   - Sort diagnostics by span then code; sort nodes/edges by id; canonicalize/drop any
     wall-clock or otherwise non-deterministic fields.
4. Deep-diff normalized-live vs `golden.json`.
   - `update: true` → overwrite the golden on disk (via a `gen`-style writer); report
     `updated`.
   - else → return `{ id, status: 'pass' | 'fail', diff }` with a readable diff on failure.

Consumers, zero duplication:
- **CLI `todl-demo test [--update]`** → `verifyAll`, maps summary to process exit code.
- **`examples/tests/corpus.test.ts`** → `verifyAll({ update: false })`, asserts
  `failed === 0`. This fails CI when compiler output changes without a golden regen.

## The CLI (`cli/`, use case 3)

A thin, dependency-light node CLI — `todl-demo` — over `shared/`. All real logic lives in
`shared/`; the CLI is plumbing + formatting.

```
todl-demo list                        # print corpus: id, group, title
todl-demo run <id> [--stage <s>]      # compile one example, print pipeline stages
todl-demo test [--update] [--filter]  # run goldens; exit non-zero on drift
todl-demo docs [--out <dir>]          # (phase 3) emit corpus → static markdown
```

- **`run`** is the "print the pipeline stages" demo (parse → resolve → validate → emit). It
  calls the compiler and prints, per `--stage`: diagnostics, resolved-model summary, emitted
  JSON. Default prints all stages with headers. `run`'s stage output uses the **same
  normalized shape** `verify` produces — what you see is exactly what gets asserted.
- **`test`** delegates to `verifyAll` and maps the summary to an exit code — the CI entry.
- Structure: `cli/src/main.ts` (small hand-rolled arg parse, no heavy framework), one file
  per command under `cli/src/commands/`, shared formatting in `cli/src/format.ts` (stage
  headers, colorized diff).
- Wired as root script `"cli": "tsx --conditions=development cli/src/main.ts"`, with a `bin`
  in a **local** `cli/package.json` — kept out of the published root package.

## The Mural app (`app/`, use cases 1, 2, 4)

Follows Mural's demo-platform pattern: `index.html` with an importmap → `mural/dist/` **and**
`todl/dist/`, a shell `.mu` with a nav rail, and pages resolved by `ContentControl` +
`DataTemplate` keyed on each page's VM. `.mu` files precompile to `.mu.js` via Mural's
`build:demos`-style tooling; a root `app:build` script runs that + the demo tsconfig.

Shell wiring mirrors `demo/platform`: a `registry` of pages, a `NavigationService`
self-populated from it, nav rail bound via `$service(NavigationService)`. No hand-built root
VM.

### Shared sub-component — `ExampleRunnerVM`
Editor (Mural `TextBox`, multiline) + live `check()` + output panels. Embedded by all three
pages — editable in Playground, read-only in Docs, badge-only in Gallery — keeping
compile-and-render logic in exactly one place. Uses the same `shared/verify` normalize path
so client-side output matches CLI/tests.

### Pages
1. **Playground (use case 1)** — `PlaygroundVM`. Editable `.todl`; Run action + debounced
   auto-run calls `check()`. Output region **phase 2 = text panels**: diagnostics list
   (severity-colored, click → jump to span), emitted-JSON tree, resolved-model summary.
   **Phase 3** adds a `Diagram` view of the typed graph as a selectable tab. "Load example…"
   pulls any corpus entry into the editor.
2. **Gallery (use case 2)** — `GalleryVM`. Corpus grouped by `manifest.group`; each card
   shows title + tags + a live pass/fail badge from `verifyExample` run in-browser. Click →
   opens in Playground.
3. **Docs / showcase (use case 4)** — `DocsVM`. Corpus ordered by `group`+`order`, rendered
   as narrative: each section is the manifest's markdown `narrative` followed by its runnable
   snippet (read-only editor + live output). Every snippet is a verified corpus example — no
   drift between prose and behavior.

## Testing

- **`shared/tests/`** — unit tests for the corpus loader, normalizer determinism, and diff.
- **`examples/tests/corpus.test.ts`** — the regression backbone: `verifyAll({update:false})`
  clean.
- **CLI** — thin tests over a fixture corpus.
- **App VMs** — logic-level tests where practical; the shell itself is verified by running it
  (no in-repo headless-DOM harness for Mural).
- Run via a new **`test:corpus`** script (these live outside `src/`, so they are separate
  from the existing `test` glob `src/**/*.test.ts`).

## Data flow

```
examples/*  ──gen:corpus──▶  corpus.generated.ts  ──▶  shared/corpus.ts
                                                            │
        ┌───────────────────────────────────────────────────┼──────────────────────────────┐
     shared/verify.ts  (seeded IdGen + canonical normalize + golden diff)                    │
        │                     │                          │                      │
   cli test              examples/tests/corpus.test    app Gallery badge   app Playground/Docs
  (exit code / CI)       (fails CI on output drift)     (client-side verify) (live check() render)
```

## Phasing (each phase independently shippable, tree stays green)

**Phase 1 — Corpus + shared + CLI + goldens.** `examples/` with the first ~6–10 curated
examples, `gen-corpus.mjs`, `shared/corpus` + `shared/verify`, `todl-demo`
(`list`/`run`/`test`), the node golden test. Delivers use cases 2 + 3 with zero UI.

**Phase 2 — Mural app, text phase.** Shell + registry + nav, `ExampleRunnerVM` with text
output panels, Playground + Gallery + Docs. Delivers use cases 1 + 4.

**Phase 3 — Graph view + docs export.** `Diagram` view in `ExampleRunnerVM`; `todl-demo docs`
static-markdown emit. — **DONE 2026-09-01** (typed-graph view: pure `shared/graph-layout.ts` +
imperative Mural `Canvas`/`Line` render behind a JSON/Graph toggle; `todl-demo docs [--out]`
driven by pure `shared/docs-markdown.ts`).

**Phase 4 — Playground power features.** — **DONE 2026-09-01** (own spec:
`…-phase4-design.md`). Full pipeline-stage tabs (Tokens→AST→Model→Diagnostics→JSON→Graph, pure
`shared/compile-stages.ts`); URL-hash permalinks (pure `shared/permalink.ts` + `permalink-sync`);
live vs-golden chip (pure `shared/golden-compare.ts`); emitted-JSON download/copy.

**Phase 5 — Graph view depth.** — **DONE 2026-09-01** (own spec: `…-phase5-design.md`).
Arrowheads + edge-kind labels; click-to-select node inspector (id·tier·typeOf·attrs, via
`LaidOutNode` enriched in pure `shared/graph-layout.ts` + a `SelectableNodeBorder`); pan/zoom
(`+`/`−`/`Fit` buttons + Ctrl+wheel + drag-pan via a `GraphCanvas`/`ScrollViewer` in `buildGraphView`).

## Seed corpus (Phase 1)

Curated from proven, known-good language features (their behavior is already established, so
they make reliable golden fodder):
- Prelude primitives & the root `Element` concept.
- Taxonomy bare resolution across siblings.
- Author-defined operators materializing edges.
- Operator value expressions on RHS / in arrays.
- Inline (anonymous) object literals.
- Namespace-scoped resolution + qualified names.
- Type-directed references (value = edge vs. attribute by member type).
- A multi-file `checkAgainst` example (base + consumer) to exercise published-base
  resolution.
- At least one **intentional-error** example (non-empty `diagnostics` golden) so the harness
  proves it captures failures, not just clean output.

## Open risks / notes

- **Determinism** is load-bearing: without the seeded `IdGenerator` + canonical sort, goldens
  churn every run and the regression story collapses. It is confined to the verify/demo path.
- **`.mu` precompile step** must run before the app loads (no bundler; native ESM + importmap
  like Mural's demo). `app:build` sequences it.
- **Mural/TODL dist coupling in the browser:** the importmap references built `dist/`; the
  app's dev loop needs both packages built (or their `development` condition wired) — document
  in `app/`'s README.
