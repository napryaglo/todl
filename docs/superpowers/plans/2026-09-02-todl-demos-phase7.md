# TODL demos Phase 7 — CI gate + GitHub Pages deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a CI test gate (tests + goldens + typecheck on every push/PR) and
an automatic GitHub Pages deploy of the demo app after a green push to `main`.

**Architecture:** Two GitHub Actions workflows. `ci.yml` runs the secret-free
node test suite. `deploy.yml` fires via `workflow_run` after CI succeeds on
`main`, ephemerally swaps the app's Mural `file:` dep for published
`@pragmatic-tech-ai/mural@^0.45.0` (GitHub Packages), builds the app with
`--base=/todl/`, and publishes `app/dist` to Pages.

**Tech Stack:** GitHub Actions, `actions/setup-node@v4`,
`actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`, Vite, npm.

**Spec:** `docs/superpowers/specs/2026-09-02-todl-demos-phase7-design.md`

## Global Constraints

- **Node 22** on CI — the test scripts glob `node --test`, which needs Node
  >=21 (Node 20 fails with `Could not find 'src/**/*.test.ts'`); 22 is LTS and
  matches local Node 24. (`engines` says >=20 but understates the real floor.)
- **Test gate stays secret-free** — root `todl` has zero `@pragmatic-tech-ai/*`
  deps; do not add any registry auth to `ci.yml` beyond the inert
  `PACKAGES_TOKEN: ${{ github.token }}` noise-suppressor.
- **Gate on `npm run build`, not `npm run typecheck`** — the whole-repo
  typecheck is pre-existingly red (~92 strict-null errors in test files only,
  which `tsx` never surfaces). `npm run build` (`tsc -p tsconfig.build.json`,
  excludes `*.test.ts`) is the green type/compile check. Do not "fix" the test
  files — out of scope.
- **Never commit the Mural dep swap** — `app/package.json` stays
  `"@pragmatic-tech-ai/mural": "file:../../Mural"`; the published-version swap
  happens only in the runner via an explicit-by-name `npm install
  @pragmatic-tech-ai/mural@^0.45.0` (NOT `npm pkg set` + bare install, which
  keeps the stale link-lock symlink).
- **Base path `/todl/` only in the deploy build** — never in `vite.config.ts`,
  never in local `dev`/`build`.
- Exact published Mural version floor: `^0.45.0` (local == published == 0.45.0
  today).
- Pages URL: `https://pragmatic-tech-ai.github.io/todl/`.

---

### Task 1: Deploy-build proof (de-risk before writing any workflow)

Prove the published-Mural swap + base-path build works locally, so the one
part CI can't dry-run is already known-good. This task writes no committed
code — it validates an assumption and is a hard gate on the rest.

**Files:**
- Temporarily edit (then restore): `app/package.json`
- Read: `app/dist/index.html` (build output)

**Interfaces:**
- Produces (for later tasks): confirmation that `--base=/todl/` emits
  `/todl/assets/...` and that published Mural 0.45.0 satisfies the app.

- [ ] **Step 1: Snapshot the app manifest**

```bash
cd "c:/Users/Eugene/Projects/architecture-agent/TODL"
cp app/package.json app/package.json.bak
```

- [ ] **Step 2: Swap Mural to the published version**

```bash
npm --prefix app pkg set "dependencies.@pragmatic-tech-ai/mural=^0.45.0"
```

- [ ] **Step 3: Create a temporary app/.npmrc for the local install**

`.npmrc` is gitignored, so this file is throwaway (never committed — the deploy
workflow writes its own at runtime). Write `app/.npmrc`:

```
@pragmatic-tech-ai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${PACKAGES_TOKEN}
```

- [ ] **Step 4: Install from GitHub Packages using the local token**

Load `PACKAGES_TOKEN` from the gitignored `ai_ea/setup-github.ps1` (per the
stored GitHub-token reference) into the environment, then:

```bash
# PowerShell: . .\ai_ea\setup-github.ps1 to populate $env:PACKAGES_TOKEN, or
# export PACKAGES_TOKEN=... in bash from the same value
PACKAGES_TOKEN="$PACKAGES_TOKEN" npm --prefix app install
```

Expected: install completes; `app/node_modules/@pragmatic-tech-ai/mural` is the
published 0.45.0 tarball (not a symlink to the sibling).

- [ ] **Step 5: Build todl, then the app with the Pages base**

```bash
npm run build
npm --prefix app run build -- --base=/todl/
```

Expected: both succeed; `app/dist/` is produced.

- [ ] **Step 6: Assert the base path is baked in**

```bash
grep -o '/todl/assets/[^"]*' app/dist/index.html | head -3
```

Expected: at least one `/todl/assets/...` reference. If assets are referenced
as `/assets/...` (no `/todl/`), the base flag did not take — stop and fix
before proceeding.

- [ ] **Step 7: Restore the committed manifest and delete the temp .npmrc**

```bash
mv app/package.json.bak app/package.json
rm -f app/.npmrc
# reinstall the file: link so local dev is back to the sibling
npm --prefix app install
```

Verify `app/package.json` again reads `"@pragmatic-tech-ai/mural": "file:../../Mural"`,
`app/node_modules/@pragmatic-tech-ai/mural` is a symlink again, and
`git status --porcelain` is clean (no committed artifact from this task — it is
a pure verification gate).

---

### Task 2: CI test-gate workflow (`ci.yml`)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a workflow **named `CI`** (the exact `name:` string is consumed by
  Task 4's `deploy.yml` `workflow_run.workflows: [CI]` — they must match).

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      # Inert: root has no @pragmatic-tech-ai deps, nothing scoped installs.
      # Set only so the repo .npmrc's ${PACKAGES_TOKEN} reference is defined.
      PACKAGES_TOKEN: ${{ github.token }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # `npm run build` typechecks + compiles the shippable source
      # (tsconfig.build.json excludes *.test.ts). The whole-repo
      # `npm run typecheck` is NOT the gate: it has pre-existing strict-null
      # errors in test files only, which tsx never surfaces (tests pass).
      - run: npm run build
      - run: npm test
      - run: npm run test:corpus
```

- [ ] **Step 2: Validate the YAML parses**

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('.github/workflows/ci.yml','utf8'); if(!/name:\s*CI/.test(s)) throw new Error('name missing'); console.log('ci.yml ok, name=CI')"
```

Expected: prints `ci.yml ok, name=CI`. (Full YAML lint happens in Task 5.)

- [ ] **Step 3: Confirm the gate commands are green locally (CI parity)**

```bash
npm run build && npm test && npm run test:corpus
```

Expected: build clean; 607 tests pass; 48 corpus tests pass. (Do NOT gate on
`npm run typecheck` — it is pre-existingly red in test files; see Global
Constraints.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(demos): test gate — typecheck + tests + goldens on push/PR"
```

---

### Task 3: Root `app:build:pages` script

A committed, local reproduction of the Pages base build (used by the spec's
verification and future manual checks).

**Files:**
- Modify: `package.json` (root) — `scripts`

**Interfaces:**
- Consumes: the app `build` script and the `--base` passthrough proven in
  Task 1.

- [ ] **Step 1: Add the script**

In root `package.json` `scripts`, after `"app:verify"`, add:

```json
"app:build:pages": "npm run build && npm --prefix app run build -- --base=/todl/",
```

- [ ] **Step 2: Verify it parses and is registered**

```bash
node -e "const s=require('./package.json').scripts; if(!s['app:build:pages']) throw new Error('missing'); console.log(s['app:build:pages'])"
```

Expected: prints the command string.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(demos): add app:build:pages (Pages base build repro)"
```

---

### Task 4: Deploy workflow (`deploy.yml`)

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: workflow name `CI` from Task 2; the `--base=/todl/` build proven in
  Task 1. Writes its own `app/.npmrc` at runtime (`.npmrc` is gitignored).

- [ ] **Step 1: Write `.github/workflows/deploy.yml`**

```yaml
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

jobs:
  build:
    # Only after a GREEN CI run on main (or a manual dispatch).
    if: >-
      github.event_name == 'workflow_dispatch' ||
      github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    env:
      # Public-visibility GitHub Packages install with the ephemeral token.
      # If mural/todl-runtime are org-PRIVATE, this 401s — switch to
      # ${{ secrets.PACKAGES_TOKEN }} (a PAT with read:packages).
      PACKAGES_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      # .npmrc is gitignored — write the scope→GitHub Packages mapping at runtime
      # so the app install resolves @pragmatic-tech-ai/* (default registry stays npmjs).
      - name: Configure GitHub Packages auth for the app install
        run: |
          printf '@pragmatic-tech-ai:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${PACKAGES_TOKEN}\n' > app/.npmrc
      # Use published Mural instead of the file: sibling (absent on CI).
      # EXPLICIT-BY-NAME install: the committed app/package-lock.json pins mural
      # as `"link": true → ../../Mural`; a bare `npm install` honors that stale
      # link over a changed spec and leaves a dangling symlink on CI, so
      # vite.config's `@pragmatic-tech-ai/mural/tooling` import fails. Explicit
      # install forces a registry install + brings in the app's other deps.
      - run: npm --prefix app install @pragmatic-tech-ai/mural@^0.45.0
      - run: npm --prefix app run build -- --base=/todl/
      - uses: actions/upload-pages-artifact@v3
        with:
          path: app/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate the YAML parses and references CI**

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('.github/workflows/deploy.yml','utf8'); if(!/workflows:\s*\[CI\]/.test(s)) throw new Error('CI ref missing'); if(!/--base=\/todl\//.test(s)) throw new Error('base missing'); console.log('deploy.yml ok')"
```

Expected: prints `deploy.yml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(demos): deploy showcase to GitHub Pages after green main"
```

---

### Task 5: YAML lint both workflows

**Files:**
- Read: both workflow files

**Interfaces:**
- Consumes: `ci.yml`, `deploy.yml` from Tasks 2 and 4.

- [ ] **Step 1: Structurally validate both files parse as YAML**

Prefer a real parser. If `python` is available:

```bash
python -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/ci.yml','.github/workflows/deploy.yml']]; print('both parse')"
```

If not, install a throwaway parser and check:

```bash
npx --yes js-yaml .github/workflows/ci.yml > /dev/null && npx --yes js-yaml .github/workflows/deploy.yml > /dev/null && echo "both parse"
```

Expected: `both parse` (no parse error). If the parser is unavailable offline,
fall back to a careful manual read confirming indentation and that every `on:`,
`jobs:`, `steps:` block is well-formed.

- [ ] **Step 2: No commit** (read-only validation task).

---

### Task 6: README — badge, live URL, Pages setup, token fallback

**Files:**
- Modify: `README.md` (root) — or `app/README.md` if the root has no suitable
  section; check which exists and is the natural home.

**Interfaces:**
- Consumes: workflow name `CI`; Pages URL `https://pragmatic-tech-ai.github.io/todl/`.

- [ ] **Step 1: Determine the README home**

```bash
node -e "console.log('root README:', require('fs').existsSync('README.md'))"
```

Add a short **"CI & showcase"** section to the root `README.md` (create the
section if absent). Content to include verbatim:

- CI status badge:
  `[![CI](https://github.com/pragmatic-tech-ai/todl/actions/workflows/ci.yml/badge.svg)](https://github.com/pragmatic-tech-ai/todl/actions/workflows/ci.yml)`
- Live showcase: `https://pragmatic-tech-ai.github.io/todl/`
- One-time enablement: "Settings → Pages → Source = **GitHub Actions**"
- Token note: "The deploy build installs Mural from GitHub Packages using the
  Actions `GITHUB_TOKEN`. If those packages are org-private, add a
  `PACKAGES_TOKEN` repo secret (a PAT with `read:packages`) and point the
  deploy job's `PACKAGES_TOKEN` at it."

- [ ] **Step 2: Verify the badge markup is present**

```bash
grep -q "actions/workflows/ci.yml/badge.svg" README.md && grep -q "pragmatic-tech-ai.github.io/todl" README.md && echo "readme ok"
```

Expected: `readme ok`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(demos): CI badge, live showcase URL, Pages setup + token note"
```

---

### Task 7: Update the parent spec Phasing section

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md` (Phasing
  section)

- [ ] **Step 1: Mark Phase 7 complete**

Find the Phasing section and update the Phase 7 line to note it is implemented
(CI gate + Pages deploy), matching how Phases 3–6 were marked.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-09-01-todl-demos-app-design.md
git commit -m "docs(demos): mark Phase 7 complete in the phasing roadmap"
```

---

## Finish

After all tasks: use **superpowers:finishing-a-development-branch** — verify the
full gate is green (`npm run typecheck && npm test && npm run test:corpus`),
then present push options. On push, the very first CI run executes on GitHub;
report whether it goes green and whether the Pages deploy fires (it needs the
one-time Settings → Pages → "GitHub Actions" source set by the owner).

## Self-review

- **Spec coverage:** ci.yml (Task 2), deploy.yml incl. runtime-written
  `app/.npmrc` (Task 4), base-path build (Tasks 1/3/4), app:build:pages
  (Task 3), README incl. Pages setup + token fallback (Task 6), verification
  incl. the deploy-build proof (Task 1) and gate parity (Task 2) — all mapped.
  Parent-spec phasing (Task 7).
- **Placeholders:** none — every workflow file is given in full.
- **Consistency:** workflow name `CI` is defined in Task 2 and referenced by
  Task 4's `workflows: [CI]`; `--base=/todl/` identical in Tasks 1, 3, 4;
  `^0.45.0` identical in Tasks 1 and 4; `.npmrc` is gitignored, so Task 1 uses a
  throwaway copy and Task 4 writes its own at runtime — nothing scoped is
  committed.
