# TODL demos suite — Phase 7: CI gate + GitHub Pages deploy

**Date:** 2026-09-02
**Status:** design (approved to plan)
**Parent spec:** `2026-09-01-todl-demos-app-design.md` (Phasing section)
**Repo:** `@pragmatic-tech-ai/todl` (github.com/pragmatic-tech-ai/todl), branch `main`

## Goal

Close out the tests-and-demos suite with continuous integration and a live
showcase: (1) a **CI test gate** that runs the full suite on every push and
pull request, and (2) an **automatic GitHub Pages deploy** of the three-page
demo app (playground / gallery / docs) after a green push to `main`.

This is the last roadmap phase; publishing (the live site) comes last by
design.

## Context / constraints discovered during brainstorming

- **No CI exists** — `.github/` is absent. This phase introduces it.
- **Node floor** — root `package.json` declares `engines.node >=20`, but the
  test scripts pass a **glob** to `node --test`, which only supports globs on
  **Node >=21**. On Node 20 CI fails with `Could not find 'src/**/*.test.ts'`.
  CI therefore pins **Node 22** (current LTS; matches local Node 24's
  behavior). (The `engines` field understating the real floor is a pre-existing
  package discrepancy, left as-is.)
- **Test gate is secret-free.** Root `todl` has **zero `@pragmatic-tech-ai/*`
  dependencies** (all 7 deps are public npm). `npm ci` + `npm run build` +
  `npm test` + `npm run test:corpus` never touch GitHub Packages.
- **Whole-repo `npm run typecheck` is pre-existingly red** — ~59 strict-null
  errors in `src/**/*.test.ts` and ~33 in the demos tsconfig, all in test files
  that run green under `tsx` (transpile-only). Shippable source is type-clean:
  `tsconfig.build.json` excludes `*.test.ts` and passes with 0 errors. The gate
  therefore uses **`npm run build`** (which runs `tsc -p tsconfig.build.json`)
  as the type/compile check, not the red whole-repo `typecheck`. Fixing the
  test-file type debt is out of scope for this phase.
- **The app build is NOT secret-free.** `app/` depends on Mural via
  `file:../../Mural`, and **Mural depends on `@pragmatic-tech-ai/todl-runtime`**
  (GitHub Packages). So building the app touches GitHub Packages no matter how
  Mural is brought in.
- **Both repos are public** (`todl` and `mural` return 200 unauthenticated),
  but the **GitHub Packages npm registry always requires a token**, even for
  public-visibility packages.
- **No drift today:** local Mural is `0.45.0`, published Mural is `0.45.0`.
- **`.npmrc` is gitignored repo-wide** (`.gitignore` line 6) and **untracked**
  — the repo-root `.npmrc` (which maps `@pragmatic-tech-ai` → GitHub Packages
  with `_authToken=${PACKAGES_TOKEN}`) exists only on local disk, never in git,
  so tokens never land in the repo. Consequence: CI cannot rely on any
  committed `.npmrc`. The deploy workflow must **write `app/.npmrc` at runtime**
  before the app install, because `npm --prefix app install` does not inherit
  the repo-root scope mapping.

## Decisions (from brainstorming)

1. **Mural in the Pages build → published package + token.** CI installs
   published `@pragmatic-tech-ai/mural@^0.45.0` from GitHub Packages rather than
   checking out and building Mural from source. The app's committed dependency
   stays `file:../../Mural` (local dev unchanged); CI swaps it *ephemerally*.
2. **Deploy trigger → auto on green push to `main`** (plus manual dispatch).

## Architecture

Two GitHub Actions workflows under `.github/workflows/`.

### Workflow 1 — `ci.yml` (test gate)

```
name: CI
on:
  push:
  pull_request:
```

- Single job, `runs-on: ubuntu-latest`, Node 22 via `actions/setup-node@v4`
  with `cache: npm` (Node 22, not 20 — the test-runner glob needs >=21).
- Steps: `checkout` → `setup-node` → `npm ci` → `npm run build` →
  `npm test` → `npm run test:corpus`. (`npm run build` is the type/compile
  check — see the pre-existing-typecheck note above.)
- `env: { PACKAGES_TOKEN: ${{ github.token }} }` at the job level — purely to
  keep the repo `.npmrc`'s `${PACKAGES_TOKEN}` reference from emitting an
  unset-variable warning. Nothing scoped installs, so the token value is never
  actually used.
- No other secrets. This is the workflow intended to be the required status
  check for `main`.

### Workflow 2 — `deploy.yml` (Pages deploy)

```
name: Deploy showcase
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  packages: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
```

- Guard the job: `if: github.event.workflow_run.conclusion == 'success' ||
  github.event_name == 'workflow_dispatch'`. This is what makes the deploy fire
  only after a **green** `main` run.
- Build job steps:
  1. `checkout`
  2. `setup-node@v4` (Node 20, `cache: npm`)
  3. `npm ci` — root install (public deps only).
  4. `npm run build` — compile todl → `dist/` (the app's Vite alias
     `@pragmatic-tech-ai/todl` → `../dist/index.js` needs this present).
  5. **Ephemeral Mural swap:**
     `npm --prefix app pkg set "dependencies.@pragmatic-tech-ai/mural=^0.45.0"`
     — mutates `app/package.json` in the runner only; never committed.
  6. `npm --prefix app install` — resolves published Mural + transitive
     `todl-runtime` from GitHub Packages, authed via a **runtime-written**
     `app/.npmrc` (a workflow step, since `.npmrc` is gitignored) and
     `env: { PACKAGES_TOKEN: ${{ secrets.GITHUB_TOKEN }} }`.
  7. `npm --prefix app run build -- --base=/todl/` — production bundle to
     `app/dist` with the project-site base path.
  8. `actions/upload-pages-artifact@v3` with `path: app/dist`.
- Deploy job: `needs: build`, `environment: github-pages`,
  `actions/deploy-pages@v4`.

### `app/.npmrc` (written at deploy time, never committed)

`.npmrc` is gitignored repo-wide, so the deploy workflow writes it as a step
before the app install:

```
@pragmatic-tech-ai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${PACKAGES_TOKEN}
```

This maps only the `@pragmatic-tech-ai` scope to GitHub Packages, leaving the
default registry at npmjs so the app's public deps (monaco, vscode-*) resolve
normally. It never enters git; local dev uses the sibling `file:` link and
never reads it.

### Vite base path

The project site lives at `https://pragmatic-tech-ai.github.io/todl/`, so the
Pages build needs `base: '/todl/'` for asset URLs to resolve. Passed as a CLI
flag (`vite build --base=/todl/`) **only in the deploy build** — local
`npm run dev` / `npm run build` stay at `base: '/'`. No `vite.config.ts` change.

Why the base flag is safe for this app:
- In-app navigation is VM state (`AppVM.ActivePage`), not URL paths — no SPA
  history routing, so no 404-on-refresh problem and no need for a Pages SPA
  fallback.
- Permalinks use the URL **hash** (`#s=…`), unaffected by base.
- The Monaco editor worker is loaded via `new Worker(new URL(...))`, which Vite
  rewrites for the configured base automatically; Monaco's own workers are
  bundled through the `?worker` import.

### Root script (new)

`"app:build:pages": "npm run build && npm --prefix app run build -- --base=/todl/"`
— a local reproduction of the deploy build (asset-base parity), used for the
verification step and future local checks.

## One-time manual setup (repo owner)

GitHub Pages must be told to serve from Actions: **repo Settings → Pages →
Build and deployment → Source = "GitHub Actions"**. This cannot be scripted;
it is documented in the README. Until it is set, `deploy-pages` fails with a
clear "Pages not enabled" error and the CI gate is unaffected.

## Token fallback

The plan uses the ephemeral `GITHUB_TOKEN` with `packages: read`. This works
if the `mural` and `todl-runtime` packages are **public-visibility** on GitHub
Packages. If they are org-*private*, `npm --prefix app install` fails with a
401; the fix is a one-line switch of the deploy job's
`PACKAGES_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to
`PACKAGES_TOKEN: ${{ secrets.PACKAGES_TOKEN }}` (a classic PAT with
`read:packages`, added under repo secrets). Documented in the deploy workflow
as a comment.

## Testing / verification strategy

CI YAML cannot be unit-tested, so verification is command-level:

1. **Gate parity** — the gate commands (`npm ci`, `npm run build`, `npm test`,
   `npm run test:corpus`) all pass locally (build clean, 607 + 48 green);
   re-run them to confirm the exact CI sequence is green before committing the
   workflow.
2. **Deploy-build proof (the one risky part)** — locally reproduce the
   published-Mural swap end to end *before* trusting CI:
   - copy `app/package.json`, run
     `npm --prefix app pkg set "dependencies.@pragmatic-tech-ai/mural=^0.45.0"`,
   - `npm --prefix app install` against GitHub Packages using the local
     `PACKAGES_TOKEN` (from the gitignored `ai_ea/setup-github.ps1`, per the
     stored GitHub-token reference),
   - `npm --prefix app run build -- --base=/todl/`,
   - assert `app/dist/index.html` references assets under `/todl/` (grep the
     emitted HTML for `/todl/assets/`),
   - restore `app/package.json` to `file:../../Mural`.
   This proves published Mural 0.45.0 satisfies everything the app uses
   (including the Phase 6 DomHost / transforms / pointer APIs) and that the
   base-path build is correct.
3. **YAML sanity** — validate both workflow files parse (a small Node
   `js-yaml`/`yaml`-free check, or `python -c yaml.safe_load` if available;
   otherwise a structural read-through).
4. **README** — CI badge renders against the real workflow name; live URL and
   Pages-source note are present.

The deploy workflow itself is only truly exercised once pushed (that is the
nature of `workflow_run` + Pages), so the local deploy-build proof is the
gate that de-risks it.

## Files

- **Create** `.github/workflows/ci.yml`
- **Create** `.github/workflows/deploy.yml` (writes `app/.npmrc` at runtime)
- **Modify** root `package.json` — add `app:build:pages` script
- **Modify** root `README.md` (or `app/README.md`) — CI badge, live URL,
  one-time Pages-source instruction, token-fallback note

## Out of scope

- Branch protection / marking the CI check "required" — a repo setting the
  owner applies; noted in README, not automated.
- Publishing `todl` to npm on release / release tagging — separate concern.
- Running the Playwright/Edge render-check in CI — it depends on system Edge
  from a Plexus `node_modules` path that does not exist on CI runners; the
  node-level gate (tests + goldens + typecheck) is the CI contract. The
  deploy-build proof covers "the app compiles and bundles."
- Custom domain / CNAME.
```

