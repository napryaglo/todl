# SP4 — Edge-record cleanup (dead operator attr + lexer-valid ids) — Design

**Date:** 2026-08-11
**Branch:** `feat/sp4-edge-record-cleanup` (off TODL `main` @ 9521dc4)
**Program:** reference-integrity fix, sub-project 4 of 5 (SP1 union targets + SP2 meta-model retype + SP3 data migration landed on TODL `main`; SP5 = Plexus consumers + republish).

## Goal

Remove two latent defects in the edge-record code path so native edge syntax
(`from --> to`) is clean and round-trippable: (1) `parseEdgeRecord` injects a
synthetic `operator` attr that no concept declares and nothing reads (dead
data — see [[todl-edge-record-roundtrip]]); (2) it mints synthetic ids
containing `#` (and the connectors container an id with a `-`), neither of which
is a valid C-like identifier, so re-emitting them fails the lexer. Also strip
the 42 dead `operator = "…"` lines the flattened `landscape.todl` carries.

## Scope decision (measured, deliberate)

Native edge syntax is **currently unused** — the whole corpus is flattened
verbose form (`step stepN { src=…; dst=…; operator="->"; }`), and the `operator`
attr is written only by the parser and read nowhere in TODL. So the round-trip
"breaks" are latent, not active. SP4 is deliberately the **focused cleanup**:
fix the two correctness/cleanliness defects and remove the dead data. It does
**not** add emitter edge-shorthand or the full native-nested-step ↔ flattened
round-trip — those are a real serialization feature, but nothing consumes it
until the visual engine emits edges back to TODL (YAGNI).

## Evidence

- `operator` values in `landscape.todl`: 34 × `"->"`, 8 × `"-->"` (the `->` on
  steps, `-->` on connectors — the arrow correlates with concept, carrying no
  independent model meaning; the connector's real semantics are its `type`).
- `operator` is read nowhere in TODL src except where written
  (`parser.ts:394`).
- `parseEdgeRecord` id: `` `${concept}#${n}` `` (`parser.ts:408`);
  `parseApplicationConnectors` id: `` `application-connectors#${n}` ``
  (`parser.ts:422`). `#` and `-` are not valid identifier characters
  (C-like identifiers, kebab removed).
- The project validates 0 diagnostics today (operator accepted as an undeclared
  attr), and must stay 0 after the data cleanup.

## Component 1 — Parser (`src/parse/parser.ts`)

In `parseEdgeRecord`:
- **Remove** the `{ name: "operator", value: … }` assignment (line ~394). The
  arrow is still consumed by `consumeEdgeOperator()` (syntax), just not stored.
  So the parsed instance carries only `from`/`to` (or `src`/`dst`) + any
  explicit `{ … }` fields.
- **Change the synthetic id** from `` `${concept}#${(this.edgeSeq += 1)}` `` to
  `` `${concept}_${(this.edgeSeq += 1)}` `` (line ~408).

In `parseApplicationConnectors`:
- **Change the container id** from `` `application-connectors#${(this.edgeSeq += 1)}` ``
  to `` `application_connectors_${(this.edgeSeq += 1)}` `` (line ~422).

`consumeEdgeOperator()` is unchanged — it still accepts `->` / `-->` so both
authoring arrows parse; the returned glyph is simply discarded now.

## Component 2 — Data cleanup

`scripts/strip-edge-operator.ts` (committed, reproducible — like SP3's
`migrate-arch-refs.ts`): removes whole lines matching
`^\s*operator\s*=\s*"[^"]*"\s*;\s*$` from each given `.todl` file, in place,
printing the per-file removal count.

Run against `landscape.todl` (expected: 42 removed) and `model.todl`
(expected: 0). Then the SP3 `check-project.ts` gate must still report
**0 data-file diagnostics**.

## Component 3 — Tests (TODL suite)

`src/parse/tests/edge-record.test.ts`:
- **`connector a --> b;`** parses to an instance with `from`/`to` name
  assignments, **no** `operator` assignment, and `id` matching `/^connector_\d+$/`.
- **`step a -> b;`** (inside a sequence/model context per the real grammar)
  parses to `src`/`dst`, no `operator`, id `/^step_\d+$/`.
- **Round-trip:** parse a native edge record into a model, emit via
  `emitModelTodl(own, namespace, bindings, conforms?)` (`src/emit/todl.ts`),
  and re-parse the emitted text — assert **zero parse diagnostics** (proves the
  id is lexer-valid and no `operator` leaks). The exact model→`TodlDocument`
  and `emitModelTodl` call shape mirror `src/emit/tests/todl.test.ts`.

The test source shapes (how a native edge record is authored — top-level,
in a `model`, or in a `connectors { … }` block) are copied from the existing
`parseEdgeRecord` call sites and any current edge-record parser test, not
invented.

## Testing

- Parser + round-trip tests above green.
- Full TODL suite green (parser change touches shared `parseEdgeRecord`; the
  suite is the regression net — any test asserting the old `operator` attr or
  `#`-id is updated to the new shape).
- `check-project.ts` gate: **0** data-file diagnostics after the operator strip.

## Out of scope (deferred / YAGNI)

- Emitter edge-shorthand (`from --> to;`) — **later**, when the viz emits edges.
- Full native-nested-step ↔ flattened round-trip (steps inline in a sequence
  with implicit ordering vs. `step stepN {…}` records + a `steps=[…]` list) —
  **later**.
- `connector.type` (undeclared quoted taxonomy ref `type = "connectors.…"`) —
  an SP2-class retyping gap, orthogonal to edge records. **Noted, not fixed.**
- Plexus consumers + republish — **SP5**.

## Risks

- If a Plexus consumer reads the `operator` attr off a loaded model, removing it
  surfaces there. `operator` is undeclared and dead in TODL; any Plexus
  dependency is an SP5 concern (SP5 rebuilds consumers). Flag, do not chase.

## Constraints

- Data dir `plexus_tests/architecures/test_architecture/` is **not a git
  repository**: `.todl` edits are on-disk (produced by the committed strip
  script), not version-controlled. Only TODL-repo artifacts (parser change, the
  strip script, tests, spec, plan) are committed on `feat/sp4-edge-record-cleanup`.
- Every TODL test file in a `tests/` subfolder next to its source.
- Real enums, no string-literal unions.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No `npm publish`, no git push, no TODL version bump.
