# TODL demos app (Mural + Vite)

Phase 2 of the tests-and-demos suite: a browser app (playground + gallery +
docs) built with the **Mural** UI framework and bundled by **Vite**. It consumes
the same `shared/` verify core and `examples/` corpus as the CLI and tests — one
corpus, many surfaces.

> Status: **full app** (Phases 2–4 complete, per the `…-phase2/3/4.md` plans).
> Three pages behind a nav rail, all driven by the same corpus and running the
> todl compiler live in the browser: a six-tab pipeline playground (with
> permalinks, a vs-golden chip, and JSON download/copy), a gallery, and a
> docs-showcase. (Phase 3 also added a CLI `todl-demo docs [--out <dir>]`
> static-markdown export — outside this app.)

## Pages

- **Playground** — pick a corpus example (or start from a blank/editable one) and
  edit its source; a 300ms-debounced compile drives a **six-tab pipeline view**:
  **Tokens → AST → Model → Diagnostics → JSON → Graph**, each a real compiler
  artifact (`tokenize`/`parse`/`check`/`toJSON`). The Graph tab is an
  imperatively-built `Canvas` of `Border` nodes + `Line` edges (Phase 3), laid out
  by the pure `shared/graph-layout.ts`, with **arrowheads + edge-kind labels**, a
  **click-to-select node inspector** (id · tier · typeOf · attrs), and **pan/zoom**
  (`+`/`−`/`Fit`, Ctrl+wheel, drag-to-pan) — Phase 5. Phase-4 additions:
  - **Permalinks** — the editor source round-trips through the URL hash
    (`#s=<base64url>`), so a playground state is bookmarkable/shareable ("Copy
    link"); loading a hashed URL seeds the editor.
  - **vs-golden chip** — when a single-source corpus example is loaded, a chip
    shows whether the (edited) source still matches its committed golden.
  - **Download / Copy** — save or copy the emitted JSON.

  The pure cores (`shared/compile-stages.ts`, `permalink.ts`, `golden-compare.ts`)
  are node-tested; all DOM access lives in `permalink-sync.ts` / `download.ts`.
- **Gallery** — a card per example with its title, tags, and a pass/fail badge
  from `verifyExample`; clicking a card opens it in the playground.
- **Docs** — a master-detail showcase: heading list on the left, and a detail
  pane with the narrative, a clipped source snippet, a "compiles clean —
  N node(s), M edge(s)" line, and the emitted JSON.

## Run

```bash
# From the repo root, todl must be built first (the app imports the compiler
# from ../dist via a Vite alias):
npm run build

cd app
npm install      # installs vite + mural (file:../../Mural) + opentype.js
npm run dev      # Vite dev server
npm run build    # production bundle → app/dist
```

Or from the repo root: `npm run app:build` (builds todl then the app),
`npm run app:dev` (dev server), `npm run app:verify` (Playwright/Edge render
check against a preview build — see `src/ui-verify/render-check.mjs`).

## Non-obvious config (all in vite.config.ts) — learned the hard way

- **`esbuild: { keepNames: true }` is mandatory.** Mural resolves themes,
  schemes, and DataTemplates by runtime `Class.name`. Any minifier that renames
  classes breaks it (`theme 'Material' has no scheme 'Lm'`).
- **`build.target: 'esnext'`** — the bootstrap uses top-level `await`
  (`await document.fonts.ready` before mounting).
- **opentype.js shim + exact-regex alias.** opentype's ESM bundle has no default
  export but Mural imports it as one. `src/opentype-shim.mjs` re-exports the
  namespace as default; the alias `{ find: /^opentype\.js$/ }` is an *exact*
  regex so the shim's own deep import escapes the alias. `opentype.js` is a
  **direct** dependency (Mural's transitive copy doesn't hoist under `file:`).
- **`@pragmatic-tech-ai/todl` alias → `../dist/index.js`.** The compiler is
  consumed from the parent package's built dist; run `npm run build` at the repo
  root first (or the alias resolves stale/missing output).
- **`server.fs.allow`** includes the repo root and the sibling Mural dir so the
  app can import `../shared` and `../examples`.

## Bootstrap shape (src/main.ts)

```ts
const app = new Application();
app.initialize({ theme: Material, autoScheme: { light: MaterialLight, dark: MaterialDark } });
// … build/register the root visual …
app.Resources.Root = root;
await document.fonts.ready;               // Mural measures text against font metrics
app.initialize(new HtmlTarget(document.getElementById("app")!));
```
