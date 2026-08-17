# TODL File-Provenance Design

**Date:** 2026-08-17
**Status:** Approved (design)
**Repo:** `@pragmatic-lab/todl`

## Problem

A model split across several `.todl` files is reopened as one editable
`ModelDraft` via `ModelDraft.fromSources`, which records each own node's *home*
(the file it was read from) so `toTodlByFile()` can write every entity back to
its origin file. That mapping is incomplete: it is populated by re-parsing each
source and running `collectDefinitions`, which enumerates only the **named,
syntactically-declared** ids (concepts, primitives, taxonomies, annotations,
viewpoints, named instances, and their nested named children).

Entities whose ids are **minted by the loader** — reified edges (`a ==> b`, the
form scenario-step connectors take) and inline objects (`field = concept {…}`) —
are invisible to `collectDefinitions`. They receive no home, so `toTodlByFile()`
falls them through to the default `${namespace}.todl` file. The user-visible
symptom: place a scenario on a diagram (its steps materialize as reified edges),
then trigger any save that re-serializes the model, and those steps — plus
anything else homed via the same heuristic — migrate out of their source file
into the default file. Files silently lose their content; the model is unchanged
graph-wise but its on-disk partition is wrong.

This is the same mechanism behind the known "landscape.todl flattening" note.

## Root cause (confirmed)

Reproduced headlessly. `ModelDraft.fromSources`
([`src/authoring/model-draft.ts:88-96`](../../../src/authoring/model-draft.ts))
homes an id only if `collectDefinitions`
([`src/parse/references.ts`](../../../src/parse/references.ts)) enumerates it.
`collectDefinitions` records nothing for loader-minted ids — its `Operator`
branch explicitly notes "edge applications mint their ids in the loader, so they
define nothing here." The loader **is** the only place that knows the true
origin file of a minted id (it holds both the minting call and the source
`uri`), but today it discards that knowledge.

The re-parse heuristic is therefore structurally unable to home minted ids. The
fix is to make the loader — the authority — record provenance as it creates
nodes, and have `fromSources` consume that instead of re-deriving it.

## Approach: load-time provenance (chosen)

The loader records `nodeId → source-uri` for **every** own node the moment it is
created, during the same materialization pass that already loops over units
carrying their `uri`. This replaces the re-parse/`collectDefinitions` heuristic
in `fromSources` with an authoritative map covering named *and* minted ids
alike.

Rejected alternatives (from brainstorming): (a) extend `collectDefinitions` to
predict minted ids — impossible, the ids are non-deterministic and assigned only
at load; (b) post-hoc diff of own ids against re-parse results and dump the
remainder into a guessed file — a heuristic on top of a heuristic.

## Components

### 1. Provenance recorder (loader-internal)

A small mutable recorder threaded through the third (instance) materialization
pass:

```ts
interface HomeRecorder {
  current: string | null;                 // uri of the unit being materialized
  readonly map: Map<string, string>;       // nodeId → source uri
}
function recordHome(rec: HomeRecorder | undefined, id: string): void {
  if (rec !== undefined && rec.current !== null && !rec.map.has(id)) rec.map.set(id, rec.current);
}
```

`recordHome` is first-wins (`!map.has(id)`), so a node is homed to the first
file that materializes it. The recorder is optional everywhere it is threaded —
callers that do not care (a plain `load`) pass `undefined` and pay nothing.

**Recording sites** (all inside `loadInto`'s third pass and its deferred loops):
- `applyInstance` / `applyModel` — record the named instance's `decl.id` (the
  builder already assigns it) and recurse for nested named children.
- `mintReifiedEdge` — record the minted reified-edge id (the scenario-step node).
- inline-object mint — record the minted inline-object id.

`recorder.current` is set to the unit's `uri` before each apply call. The unit
loop at [`loader.ts:455`](../../../src/parse/loader.ts) already destructures
each unit; it gains `uri`. The deferred `compositions` and `termValues` lists
carry the `uri` of the source that produced them (added where they are enqueued)
so their nodes home correctly too; when a deferred item has no captured uri it
simply records nothing (falls through to the default, unchanged from today).

Base nodes are never recorded: they enter the graph via `mergeBases` (from
pre-compiled JSON), not through this pass, so provenance naturally scopes to the
just-loaded sources = the own nodes.

### 2. Expose provenance from the loader

`loadInto` gains a trailing optional out-parameter it fills:

```ts
export function loadInto(
  model: Repository,
  sources: SourceFile[],
  reserved?: ReadonlySet<string>,
  idGenerator?: IdGenerator,
  provenance?: Map<string, string>,      // NEW — filled in place if supplied
): Diagnostic[]
```

Its `Diagnostic[]` return is unchanged (many callers depend on it). `load`
allocates a map, passes it, and returns it on `LoadResult`:

```ts
export interface LoadResult {
  model: Repository;
  diagnostics: Diagnostic[];
  provenance: Map<string, string>;       // NEW
}
```

### 3. Surface provenance through the API

`check` and `checkAgainst` ([`src/api.ts`](../../../src/api.ts)) add
`provenance` to their returned object — additive and non-breaking (existing
callers destructure `{ model, diagnostics }` and are unaffected):

```ts
export function checkAgainst(...): { model: Repository; diagnostics: Diagnostic[]; provenance: Map<string, string> }
```

`checkAgainst` allocates the map, passes it to `loadInto`, and returns it.

### 4. Consume it in `ModelDraft.fromSources`

The re-parse block (`model-draft.ts:88-96`) is deleted. `fromSources` reads the
provenance the loader already computed and homes every own id from it:

```ts
const result = checkAgainst([...draft.baseDocs], sources.map((s) => ({ uri: s.uri, text: s.text })));
const compiled = toJSON(result.model);
// … own filtering unchanged …
const ownIds = new Set(draft.own.nodes.map((n) => n.id));
for (const [id, uri] of result.provenance) if (ownIds.has(id)) draft.home.set(id, uri);
```

The `parse` / `collectDefinitions` imports become unused in this file and are
dropped. `collectDefinitions` itself is untouched — it retains its role inside
the loader.

## Data flow

```
sources[] ──▶ loadInto ──▶ third materialization pass
                              │  applyInstance/applyModel    ─▶ recordHome(decl.id)
                              │  mintReifiedEdge              ─▶ recordHome(minted step id)
                              │  inline-object mint           ─▶ recordHome(minted inline id)
                              ▼
                         provenance: Map<nodeId, uri>
                              │
      checkAgainst ──────────┘  (returns { model, diagnostics, provenance })
                              │
      ModelDraft.fromSources ─┘  home.set(id, uri) for every own id
                              │
      toTodlByFile() ─────────┘  partitions own nodes/edges by home ─▶ each entity back to its origin file
```

## Testing

New TODL test (in a `tests/` subfolder next to the code it exercises),
mirroring the reproduced bug:

1. **Reified-edge provenance round-trip.** Meta-model declares a `component`
   concept, a `step` concept with `src`/`dst`, an `operator ==> : step(src,dst)`,
   and viewpoints framing each. Sources: `structure.todl` with two components,
   `flow.todl` with `web ==> db` (a reified step). Assert:
   `fromSources(...).homeOf(<minted step id>) === "flow.todl"`, and
   `toTodlByFile()` keys include `flow.todl` containing the step — **not** a
   stray `${namespace}.todl` default file. This test fails before the change
   (step homed to default) and passes after.
2. **Inline-object provenance.** A source authoring `field = concept {…}` in a
   dedicated file keeps the minted inline-object node homed to that file after
   `toTodlByFile()`.
3. **Regression.** `model-draft-multifile.test.ts` (named instances) stays
   green — named ids home identically, now sourced from the loader rather than
   the re-parse.
4. **Loader unit.** `load(sources).provenance` maps each named + minted own id
   to its source uri; a `load` with no minted ids still returns a populated map
   for named ids.

## Rollout

TODL-only change (loader + api + model-draft + tests). No behavioral change for
any existing `check`/`checkAgainst`/`load` caller (all additive). After merge:
republish `@pragmatic-lab/todl` to **local Verdaccio** (`localhost:4873`) and
bump Plexus's dependency. Plexus needs **no code change** — `ArchModel.save()`
already routes through `toTodlByFile()`; once TODL homes minted ids, saves land
in the correct file automatically.

## Constraints

- Additive only: `check`/`checkAgainst`/`load`/`loadInto` signatures gain
  optional params / return fields; no existing caller breaks.
- Provenance is first-wins and scoped to own (source-loaded) nodes; base nodes
  are never homed.
- Publish TODL only to local Verdaccio, never public npm.
- Every test file lives in a `tests/` subfolder next to its source.
