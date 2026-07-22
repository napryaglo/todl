# TODL `checkAgainst(bases, sources)`

**Date:** 2026-07-22
**Status:** Design (approved)
**Repo:** TODL (`@pragmatic-lab/todl`)
**Arc:** Sub-project 3 of 4 (architecture-model loading). The engine primitive
that lets a downstream model (library, architecture) be validated against
already-published base models (meta-models, libraries).

## Problem

`check(sources)` loads and validates a self-contained set of `.todl` sources. But
a **library** (`taxonomy microsoft : represents location, technology { … }`) and
an **architecture model** are not self-contained: their terms reference concepts
and base-taxonomy terms defined in a *meta-model* (`represents location`,
`applicable-to = [component-category.platform-api]`). Validating them requires the
meta-model present as a base. Bases arrive already compiled — as `TodlDocument`
JSON published to the meta-models / libraries backends — not as re-parseable
source.

## API

```ts
export function checkAgainst(
  bases: TodlDocument[],
  sources: SourceFile[],
): { model: Repository; diagnostics: Diagnostic[] }
```

Exported from `src/index.ts` next to `check`. Same return shape as `check`. The
returned `model` is the **merged** graph (bases + sources) — useful to a caller
that then queries or re-emits it.

**Invariant:** `checkAgainst([], sources)` is equivalent to `check(sources)`
(same diagnostics, same model shape). This is the primary conformance test.

## Design

Three parts.

### 1. Refactor the loader for reuse (behavior-preserving)

`load(sources)` today constructs `new Repository()` then runs the 3-pass load
inline. Extract everything after construction into:

```ts
export function loadInto(model: Repository, sources: SourceFile[]): Diagnostic[]
```

It parses the sources, collects names, runs pass 1 / 2a / 2b against `model`'s
builder, defines invariants, records spans, and returns the accumulated
diagnostics. Then `load` becomes a thin wrapper:

```ts
export function load(sources: SourceFile[]): LoadResult {
  const model = new Repository();
  const diagnostics = loadInto(model, sources);
  return { model, diagnostics };
}
```

No behavior change for `load` — same passes, same order, same output.

### 2. One surgical change: don't stub references that resolve to a base

The loader's unresolved-placeholder step is currently:

```ts
for (const id of referenced) {
  if (!defined.has(id)) first.assertInstance(UNRESOLVED, id);
}
```

Change to also skip ids already present in the model graph:

```ts
for (const id of referenced) {
  if (!defined.has(id) && !model.has(id)) first.assertInstance(UNRESOLVED, id);
}
```

For plain `load` the graph is empty at this point, so `model.has(id)` is always
false — behavior is identical. For `checkAgainst`, base nodes are already
committed in the graph, so a source reference that resolves to a base node
(`represents location` → the meta-model's `location`) is **not** stubbed as
UNRESOLVED. This is the mechanism that makes cross-model references resolve, and
it flows through name resolution without touching `collectNames`.

### 3. Seed a model from the bases, then load sources on top

```ts
export function checkAgainst(bases, sources) {
  const model = new Repository(mergeBases(bases));   // Repository wraps the seeded Graph
  const diagnostics = loadInto(model, sources);
  diagnostics.push(...validate(model));
  return { model, diagnostics };
}
```

`mergeBases(bases: TodlDocument[]): Graph` deserializes each base (as `fromJSON`
does — enum-by-name for `tier`/`kind`, attrs object → Map) into one shared
`Graph`, with **idempotent, first-wins dedup** so overlapping bases compose:

- **Nodes:** skip a node whose id is already present (`graph.hasNode(id)`), else
  `addNode`. First base to define an id wins.
- **Edges:** add all base nodes first (across all bases), *then* edges — an edge
  references nodes by id and both endpoints must exist. Skip an edge that
  duplicates one already present (same `kind` + `via` + `from` + `to`), so a
  shared foundation carried by two bases doesn't double an edge (which would
  double-count for cardinality).

Dedup is what lets a library be published as its **full** compiled graph (base
meta-model + its own taxonomy) rather than a computed delta: loading
`[metaModel, lib1, lib2]` sees the meta-model's `location` three times and keeps
one. This keeps SP2's publish simple.

### Validation scope

`validate(model)` runs over the whole merged model. Bases were published clean,
so re-validating them yields no new diagnostics; the meaningful diagnostics come
from the source-introduced nodes. Scoping validation to source nodes is a
possible later optimization (noise/perf), not needed for v1.

## Testing

- **Conformance (the invariant):** for a representative source set, `checkAgainst([], src)`
  returns the same diagnostic codes and same node set as `check(src)`.
- **Refactor safety:** the existing `load` / `check` / loader test suites stay
  green unchanged (proves `loadInto` extraction preserved behavior).
- **Cross-model resolve:** a base meta-model (concepts `location`, `technology`;
  a base taxonomy `component-category`) + a library-shaped source
  (`taxonomy microsoft : represents location, technology { location azure {…}
  technology azure-openai { applicable-to = [component-category.x]; } }`) →
  **zero** unresolved/error diagnostics, and the merged model contains both the
  base `location` and the source `microsoft.azure`.
- **Still-unresolved:** a source reference to a concept defined in *neither* base
  nor source is still stubbed UNRESOLVED / flagged, exactly as under `check`.
- **Base dedup:** `checkAgainst([m, m], src)` (the same base twice) neither
  throws nor changes diagnostics vs `checkAgainst([m], src)` — node and edge
  dedup hold.
- **fromJSON parity:** `mergeBases([toJSON(model)])` yields a graph equal (nodes +
  edges) to `fromJSON(toJSON(model))` for a sample model — the merge deserializes
  identically to the existing path for the single-base case.

## Out of scope

- SP2 (library project + publish that *calls* `checkAgainst`) and SP4 (architecture
  resolver). This spec is only the engine primitive.
- Delta serialization of libraries (dedup makes it unnecessary for now).
- Validation scoping to source-only nodes.
