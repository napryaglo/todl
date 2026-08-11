# SP2 — Retype tech-architecture reference endpoints — Design

**Date:** 2026-08-11
**Branch:** `feat/sp2-tech-architecture-retype` (off TODL `main` @ bde8d63)
**Program:** reference-integrity fix, sub-project 2 of 5 (SP1 union-relationship-targets landed on TODL `main`; SP2 meta-model retype → SP3 data migration → SP4 edge-record round-trip → SP5 Plexus consumers + republish).

## Goal

Close the reference-integrity hole in the `tech_architecture` meta-model: retype
every field that semantically references another concept but is currently
declared as the `identifier` primitive (which silently opts out of symbol
checking — see [[todl-reference-integrity]]). Multi-target endpoints become
**union relationships** (the SP1 capability); single-target references become
**concept-typed fields** (a field typed as a concept is already a symbol-checked
reference member). Then bump + publish TODL so the new emit shape is available
to downstream republish.

The meta-model content lives in
`C:\Users\Eugene\Projects\plexus_tests\meta-models\tech-architecture\` (Plexus
test content, outside any test-harnessed package). The TODL version bump +
published-pattern regression test live in the TODL repo.

## Why this is the right fix

The compiler enforces reference integrity only for *reference members*: a `->`
relationship, or a `:` field whose declared type resolves to a `Concept`/
`Taxonomy`. A field typed as `identifier` is an opaque attr — a bare name or a
quoted string is accepted unchecked. The tech-architecture endpoints were typed
`identifier` because their legal targets are a **union** of concepts with no
shared supertype (confirmed: no concept in the meta-model `extends` a common
base). SP1 added union relationship targets precisely to type these. Single-
target references never needed the union feature — they only needed to name the
concept instead of `identifier`.

## Section 1 — Field-by-field retyping

### Union-target → union relationships

A field cannot name multiple concept types, so these become relationships.
No cardinality marker = `One` (required single edge), matching the current
required fields.

| Concept.field | File | New declaration |
|---|---|---|
| `connector.from` | `concepts/connector.todl` | `relationship from -> actor \| block \| location \| component \| application;` |
| `connector.to` | `concepts/connector.todl` | `relationship to -> actor \| block \| location \| component \| application;` |
| `step.src` | `concepts/step.todl` | `relationship src -> actor \| block \| component;` |
| `step.dst` | `concepts/step.todl` | `relationship dst -> actor \| block \| component;` |
| `sequence.entry_point` | `concepts/sequence.todl` | `relationship entry_point -> actor \| block \| component;` |

### Single-target → concept-typed fields

Minimal change: retype the field from `identifier` to the target concept.
Preserves cardinality (`?` / `[]`) and keeps the member in the `fields:` bucket.

| Concept.field | File | Old → New |
|---|---|---|
| `connector.scenario` | `concepts/connector.todl` | `identifier?` → `scenario?` |
| `container.delivered_by` | `concepts/container.todl` | `identifier?` → `component?` |
| `application.owner` | `concepts/application.todl` | `identifier?` → `actor?` |
| `network_peer.network` | `concepts/network-peer.todl` | `identifier` → `network` |
| `application.containers` | `concepts/application.todl` | `identifier[]` → `container[]` |
| `application.consumes` | `concepts/application.todl` | `identifier[]` → `component[]` |
| `application.provides` | `concepts/application.todl` | `identifier[]` → `component[]` |
| `application.contains` | `concepts/application.todl` | `identifier[]` → `application[]` |

### Untouched (documented exceptions)

- `container.deployed_into : identifier[]` — values are compound
  `<component_id>.<slot_id>` slot references, not bare symbols; needs a
  qualified-reference feature. Stays `identifier`.
- `application.enables : identifier[]` — targets a BPMN `process`, which is not
  a concept in this meta-model (cross-meta-model resolution). Stays `identifier`.
- `meta.meta_model : identifier` — a meta-model **slug** (registry reference),
  not a concept. Stays `identifier`.
- Every `id : identifier` — the node's own identity, not a reference. Unchanged.

## Section 2 — Invariants

Every existing `invariant` block is **kept**. The compiler now enforces the
resolution + type part, but the invariants also carry rules the type system
cannot express and which remain author-facing documentation:

- **connector** — the *app-tier conditional* ("applications are valid endpoints
  only when `type` ∈ `integration` / `replacement` / `runtime_dependency`"):
  the union *widens* to always allow `application`; this invariant *narrows* it.
  Not compiler-enforced either way. Also the *"no `<location>:<id>` qualified
  form"* rule.
- **network_peer** — "resolves to a *different* known network (no self-peering)."
- **container** — the slot-resolution rules on `deployed_into` (still `identifier`).
- **application** — the ownership-uniqueness rules (a container/app_component is
  owned by exactly one parent) — a graph-cardinality rule, not a type.

The resolution sentences are lightly **reworded** from imperative spec ("Both
`from` and `to` resolve to…") to acknowledge the compiler now checks type +
resolution, so the prose no longer reads as the sole guard. No invariant block
is deleted.

## Section 3 — Validation & publish

1. **Baseline first.** Capture the meta-model's *current* diagnostics before
   editing (it may carry pre-existing ones unrelated to this work, e.g. a
   `label` primitive). The acceptance criterion is **"no new reference errors
   introduced; every union/field target resolves to a real concept,"** not
   "zero diagnostics."
2. **Headless load-check.** A `npx tsx --conditions=development` script globs all
   `.todl` under `tech-architecture/` (concepts + taxonomies + viewpoints),
   loads them through the TODL loader (`load(files)`), and prints diagnostics
   grouped by code. Repeatable, no GUI. **Instance data (landscape/model) is not
   validated here** — its quoted-string refs become errors only after this
   retyping and are SP3's concern.
3. **Version bump `0.23.0 → 0.24.0`** + `npm publish` to Verdaccio
   (`http://localhost:4873/`). SP1's `target → targets` emit-shape change needs a
   published version for downstream republish. Plexus is pinned on its current
   minor (`^0.x` pins the minor on 0.x), so publishing 0.24.0 does **not** reach
   Plexus until SP5 bumps it — nothing downstream breaks in SP2.
4. The **in-app republish** of tech-architecture to the backend is a **deferred
   manual smoke step** (requires the Electron app), recorded in the handoff.

## Section 4 — Testing

- **Meta-model load-check (primary gate):** after retyping, the script reports
  **zero `reference.undefined` on the retyped members**, and the five union
  relationships each resolve all targets — diffed against the captured baseline
  so only *new* problems fail the gate.
- **Committed TODL regression test** (`src/validate/tests/…` or
  `src/emit/tests/…`) proving the *pattern* the meta-model relies on: a small
  model mirroring the connector shape (a union relationship
  `from -> actor | block | location | component | application;` plus a
  concept-typed single-target field) loads clean, and a wrong-typed endpoint
  yields a `TargetTypeMismatch` naming the union. Locks the capability in the
  TODL suite even though the meta-model content lives in `plexus_tests`.
- **Full TODL suite green** after the bump (`npm test`); `prepublishOnly` runs
  `clean && build` on publish.

## Section 5 — Out of scope (later sub-projects)

- Migrate instance data (`landscape.todl` / `model.todl`) quoted-string refs →
  bare — **SP3**.
- Edge-record `#`-id / shorthand round-trip — **SP4**.
- Plexus consumer updates (`.target` → `.targets`, drop-factory required
  `label`, bump Plexus to `^0.24.0`) + the live in-app republish — **SP5**.
- The two exception fields (`deployed_into`, `enables`) — need compound-ref and
  cross-meta-model-union features respectively; not attempted here.

## Constraints

- Meta-model edits are in `plexus_tests/meta-models/tech-architecture/`, which
  is **not a git repository** — those `.todl` edits are applied on-disk and
  verified by the load-check, but are not version-controlled. Only TODL-repo
  artifacts (version bump, regression test, spec, plan) are committed on the SP2
  branch. The plan records the exact meta-model edits so they are reproducible.
- Every TODL test file in a `tests/` subfolder next to its source.
- Real enums, no string-literal unions.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `npm publish` targets local Verdaccio; no git push unless asked.
