# @pragmatic-tech-ai/todl

[![CI](https://github.com/pragmatic-tech-ai/todl/actions/workflows/ci.yml/badge.svg)](https://github.com/pragmatic-tech-ai/todl/actions/workflows/ci.yml)

Typed substrate for authoring and reasoning over ontologies and taxonomies —
the TypeScript rebuild of the typed-object language (TODL): language +
meta-models + model compiler (a reflective typed graph; load → validate →
emit). ESM, strict TypeScript.

## Develop

```bash
npm ci
npm run build         # gen prelude + compile shippable source (tsconfig.build.json)
npm test              # compiler + language-server suite
npm run test:corpus   # demos shared/ + examples/ + cli/ (golden snapshots)
```

The `test`/`test:corpus` suites run through `tsx` (transpile-only). The
shippable source is type-checked by `npm run build`; the whole-repo
`npm run typecheck` currently reports pre-existing strict-null errors in test
files only and is not part of the gate.

## Tests-and-demos suite

Sibling folders (`shared/`, `examples/`, `cli/`, `app/`) are the demos suite —
one verify/compile core reused by a CLI and a browser app. They are excluded
from the published package (`files: ["dist", "README.md"]`). See
[`app/README.md`](app/README.md) for the app, and
`docs/superpowers/specs/2026-09-01-todl-demos-app-design.md` for the design.

## CI & showcase

- **CI** — [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs
  `build + test + test:corpus` on every push and pull request. Secret-free.
- **Live showcase** — the playground / gallery / docs app deploys to GitHub
  Pages at **<https://pragmatic-tech-ai.github.io/todl/>** after a green CI run
  on `main` ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

### One-time Pages setup (repo owner)

In **Settings → Pages → Build and deployment**, set **Source = "GitHub
Actions"**. Until this is set, the deploy job fails with a "Pages not enabled"
error; the CI gate is unaffected.

### Deploy token note

The deploy build installs Mural from GitHub Packages (Mural → `todl-runtime`)
using the Actions `GITHUB_TOKEN` with `packages: read`. If those packages are
org-*private*, the install returns 401 — add a `PACKAGES_TOKEN` repo secret (a
PAT with `read:packages`) and point the deploy job's `PACKAGES_TOKEN` at
`${{ secrets.PACKAGES_TOKEN }}`.

## License

Apache-2.0
