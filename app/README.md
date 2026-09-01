# TODL demos app (Mural + Vite)

Phase 2 of the tests-and-demos suite: a browser app (playground + gallery +
docs) built with the **Mural** UI framework and bundled by **Vite**. It consumes
the same `shared/` verify core and `examples/` corpus as the CLI and tests — one
corpus, many surfaces.

> Status: **boot foundation** (spike-validated). The full three-page UI is built
> per `docs/superpowers/plans/2026-09-01-todl-demos-phase2.md`. `src/main.ts`
> currently renders a smoke line proving the todl compiler runs in-browser.

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
