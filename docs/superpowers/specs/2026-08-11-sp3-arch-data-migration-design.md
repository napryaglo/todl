# SP3 — Migrate architecture data refs quoted → bare — Design

**Date:** 2026-08-11
**Branch:** `feat/sp3-arch-data-migration` (off TODL `main` @ fd7285f)
**Program:** reference-integrity fix, sub-project 3 of 5 (SP1 union-relationship-targets + SP2 tech-architecture retype landed on TODL `main`; SP3 data migration → SP4 edge-record round-trip → SP5 Plexus consumers + republish).

## Goal

Make the `test_architecture` model data valid against the SP2-retyped
tech-architecture meta-model by converting quoted-string reference values on the
13 retyped members to bare names. After SP2, members like `connector.from` are
relationships and `application.owner` is a concept-typed field — both are
reference members, so a quoted string is silently dropped, leaving required
relationships empty (`cardinality.required-missing`) and optional/many fields
unreferenced. A bare name is a real, symbol-checked edge.

The data lives in
`C:\Users\Eugene\Projects\plexus_tests\architecures\test_architecture\`
(`landscape.todl`, `model.todl`) — Plexus test content, not a git repo. The
migration script, project load-check, and regression test live in the TODL repo.

## Evidence (measured, not assumed)

Loading meta-model + microsoft + aws libraries + data into one graph via
`check()` (prelude injected):

- **Before migration:** 90 data-file diagnostics, all `cardinality.required-missing`
  (quoted refs on the required relationships `from`/`to`/`src`/`dst`/`entry_point`/
  `network` are dropped; the optional/many fields lose refs silently, no error).
- **After a simulated quoted→bare conversion of the 13 retyped members:**
  **0 data-file diagnostics** — 111 conversions, all in `landscape.todl`
  (`model.todl` already had 0 quoted refs on these members). Every bare ref
  resolves; there are no genuine data gaps.

So the migration is mechanical and complete — no authoring gaps to chase.

## Why surgical textual migration (decided)

Convert quoted→bare on exactly the 13 retyped members, leaving every other byte
identical. The alternative — load `landscape.todl` and re-emit through TODL's
`.todl` emitter (which emits bare refs, todl ≥ 0.14) — is a *full* round-trip
that also re-formats the file and collides with the `operator = "-->"` /
edge-record shorthand issues that **SP4** owns. Surgical migration keeps SP3
(data refs) and SP4 (edge-record round-trip) separate and is provably complete
(0 diagnostics).

TODL's own emitter already emits reference values bare — the quoted strings are a
legacy artifact of an older generator. Ensuring the **Plexus arch emitter** emits
bare on regeneration is **SP5** (the app-side generator + live republish).

## Components

### 1. Migration script — `scripts/migrate-arch-refs.ts`

A committed, reproducible transform (safer and more auditable than hand-editing
111 lines). Reads the data files, applies one regex per retyped member, writes
back, and prints the conversion count per file.

- **Members (verbatim, the 13 SP2-retyped):** `from`, `to`, `src`, `dst`,
  `entry_point`, `scenario`, `delivered_by`, `owner`, `network`, `containers`,
  `consumes`, `provides`, `contains`.
- **Explicitly excluded:** `deployed_into`, `enables` (SP2 exceptions — still
  `identifier`; their quoted strings stay legal), and every other member.
- **Regex:** `^(\s*)(<member-alternation>)(\s*=\s*)"([^"]+)"(\s*;)` (multiline),
  replacement drops the quotes: `$1$2$3$4$5`. Only matches a single quoted value
  ending in `;` — the exact shape in the data. If any retyped member ever holds a
  list literal (`= ["a", "b"]`), the script leaves it untouched and logs it for
  manual review (measured: none exist today).

### 2. Project load-check — `scripts/check-project.ts`

Generalizes `scripts/check-metamodel.ts` to an architecture project: globs the
meta-model dir + named library files + the project's data files, loads all via
`check()`, and reports diagnostics scoped to the data files. The SP3 acceptance
gate. Paths are passed as args so it is reusable.

### 3. Regression test — `src/validate/tests/reference-value-migration.test.ts`

Locks the semantics the migration depends on, in the TODL suite (the data itself
is unversioned):

- A quoted-string value on a **required relationship** yields
  `cardinality.required-missing` (the ref is dropped, not stored) — the exact
  failure mode the migration fixes.
- The **bare** form resolves clean (0 `cardinality.required-missing`,
  0 `reference.undefined`, 0 `TargetTypeMismatch`).

## Data flow

`migrate-arch-refs.ts` rewrites `landscape.todl` + `model.todl` in place →
`check-project.ts` loads meta-model + libraries + migrated data → asserts
**0 data-file diagnostics**. Both are `npx tsx` invocations; no GUI.

## Testing

- **Project load-check (primary gate):** after running the migration,
  `check-project.ts` reports **0** data-file diagnostics.
- **Migration count check:** the script reports **111** conversions in
  `landscape.todl`, **0** in `model.todl` (measured baseline; a different count
  means the data changed and must be re-examined).
- **TODL regression test** green; **full TODL suite** green (no library code
  changed, so counts hold + the new test).

## Out of scope (later sub-projects)

- `operator = "-->"` synthetic attr + edge-record `#`-id / shorthand round-trip
  — **SP4**.
- Plexus arch emitter emitting bare refs on regeneration + `.target`→`.targets`
  consumers + live in-app republish — **SP5**.
- No TODL version bump — SP3 adds only data edits, two scripts, and a test.

## Constraints

- Data dir `plexus_tests/architecures/test_architecture/` is **not a git
  repository**: `.todl` edits are on-disk (produced by running the committed
  migration script), not version-controlled. Only TODL-repo artifacts (the two
  scripts, the regression test, spec, plan) are committed on branch
  `feat/sp3-arch-data-migration`.
- Every TODL test file in a `tests/` subfolder next to its source.
- Real enums, no string-literal unions.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No `npm publish`, no git push.
