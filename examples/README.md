# TODL example corpus

The single source of truth for TODL's tests-and-demos. Every example here is a
runnable demonstration of a language feature **and** a golden-snapshot regression
test. The CLI (`cli/`), the node regression test, and — in a later phase — the
Mural app all consume this one corpus.

## Folder shape

Each example is a folder `examples/<category>/<id>/`:

```
example.json   # manifest: id, title, group, order, tags, narrative, files, expectClean, bases?
<name>.todl    # one or more source files, loaded in manifest.files order
golden.json    # GENERATED expected output (canonicalized diagnostics + emitted document)
```

- **`narrative`** is markdown shown above the snippet in the docs showcase.
- **`files`** is the load order. Multi-file examples (cross-namespace references,
  published bases) list every file. **TODL declares one namespace per file**, so a
  two-namespace example is two files (see `namespaces/qualified-resolution`).
- **`bases`** (optional) marks files compiled as already-published bases; the
  verifier routes them through `checkAgainst` instead of `check`
  (see `bases/check-against`).
- **`expectClean`** is a human-readable intent flag; `golden.json` is authoritative.

`examples/_fixture/` holds tooling fixtures only — excluded from the generated
corpus module and the CLI/app.

## Workflow

Goldens are **generated, never hand-edited**. After adding or changing an example:

```bash
npm run gen:goldens   # recompiles every example, rewrites each golden.json, regenerates corpus.generated.ts
```

Then **eyeball the diff** before committing — a golden you have not reviewed is
not trustworthy. Clean examples must show `"diagnostics": []`; an intentional-error
example (like `errors/missing-required`) must show the expected diagnostic code.

`examples/corpus.generated.ts` is produced by `scripts/gen-corpus.mjs` (mirrors
`gen-prelude.mjs`): it inlines every manifest, source, and golden as constants so a
browser needs no filesystem — this is what makes `shared/` browser-safe for the
Phase 2 Mural app.

## Determinism

The compiler's node ids are non-deterministic (Snowflake, wall-clock), and even the
prelude is compiled that way. So `shared/verify.ts` **canonicalizes every id** to a
stable placeholder (`#n0`, `#r0`, …) in `normalize`, and sorts nodes/edges/diagnostics
canonically. Without this, goldens would churn on every run. Own nodes are selected as
*all authored nodes minus the implicit prelude and any explicit bases*, so a golden
captures concepts, fields, taxonomies, terms, models, and instances — not just
instances.

## Running

```bash
npm run test:corpus          # the regression backbone (shared + tooling + corpus + CLI tests)
npm run cli -- list          # browse the corpus
npm run cli -- run <id>      # compile one example, print pipeline stages
npm run cli -- test          # verify all goldens; non-zero exit on drift (CI smoke)
npm run cli -- test --update # regenerate goldens (then run gen:corpus)
```
