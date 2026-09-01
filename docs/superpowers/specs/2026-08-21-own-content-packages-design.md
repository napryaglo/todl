# Own-Content-Only Published Packages — Design

**Date:** 2026-08-21
**Repos:** TODL (`@pragmatic-tech-ai/todl`) + Plexus (consumer)
**Status:** approved design, pending implementation plan

## Problem

Publishing a meta-model or library copies the **entire base closure**
(prelude + referenced meta-model + upstream libraries) into the package's
`model.json`. Root causes:

- **Emit:** `compilePackage` persists `toJSON(model)`, and `model` is the full
  merged graph — `checkAgainst` seeds a `Repository` with
  `mergeBases([prelude, ...bases])` and loads the own sources on top
  ([api.ts:31-33](../../../src/api.ts)). `toJSON` walks `model.allNodes()` with
  no provenance filter ([emit/json.ts:34](../../../src/emit/json.ts)).
- **Consume:** Plexus `resolveBases` is **flat** — it reads each bound base's
  `model.json` as a self-contained document and never walks its dependencies
  (`Plexus/.../services/projects/base-resolver.ts`). So each `model.json` is
  *forced* to bake in its whole closure for references to resolve.

Consequences: every package duplicates its bases; a library bakes a **snapshot**
of the meta-model at publish time (staleness / version-skew risk); the package's
derived `classes` palette includes base classes that aren't the library's own.

**Goal:** a published package contains only its **own** compiled content and
**records** the bases it depends on; consumers resolve those bases transitively.

## Feasibility

Named entities (concepts, classes, taxonomy terms, relationships) get **stable,
name-derived ids** ([loader.ts:394](../../../src/parse/loader.ts),
[:638](../../../src/parse/loader.ts)). Only reified edges / inline objects /
anonymous instances get minted per-compile ids — and those are own content, not
cross-package reference targets. So a library's reference to a meta-model concept
resolves to the **same** stable id whether the meta-model is inlined or resolved
as a separate package. Own-only emit + transitive resolution is therefore sound
for the reference patterns that cross package boundaries.

`checkAgainst` already returns a `provenance` map (nodeId → source-uri) populated
**only** for `sources` (bases/prelude are seeded separately, never through
`loadInto`) — so `provenance.keys()` is exactly the own-node set. This is the
tool that splits own-vs-base at emit time.

## Decisions (settled)

- **Resolution model:** transitive — the package records its base refs; the
  consumer walks and dedups the chain. Consumers declare only their direct
  bindings.
- **Version pinning:** exact — record the precise `id@version` the package was
  compiled and validated against.

## Architecture

Two coordinated halves. **Ship the consumer half first** (backward-compatible),
then republish packages own-only.

### Component 1 — TODL: provenance-filtered emit

`emit/json.ts` gains an own-filtered emitter:

```ts
// Emit only the given node ids and their OUT-edges. An out-edge to a node not in
// `ownIds` (a cross-reference to a base node) is kept as a dangling id, resolved
// at load when the base package is also loaded.
export function toJSONOwn(model: Repository, ownIds: ReadonlySet<NodeId>): TodlDocument
```

Rule: emit node `N` iff `N ∈ ownIds`; emit edge `E` iff `E.from ∈ ownIds`. A
node's `typeOf`/attr references to base ids are left as-is (dangling, resolved at
load). The existing `toJSON` (full walk) stays for the `GraphPackageStore` /
diagnostics paths.

### Component 2 — TODL: package dependency metadata + own-only package

`PackageRef` and the persisted-document shape:

```ts
// publish.ts
export interface PackageRef { kind: PackageKind; id: string; version: string }
export enum PackageKind { MetaModel = 'meta-model', Library = 'library' }

// The persisted model.json shape: a TodlDocument plus recorded base deps.
// graphFromJSON / the `bases: TodlDocument[]` input path ignore `dependencies`,
// so the base-input contract is unchanged (PackageDocument is a superset).
export interface PackageDocument extends TodlDocument { dependencies?: PackageRef[] }
```

`compilePackage` changes:

```ts
export function compilePackage(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  identity: PackageIdentity,
  dependencies?: readonly PackageRef[],   // caller-supplied base refs
): CompileOutcome
```

- Compile via `checkAgainst(bases, sources)` → `{ model, provenance }` (unchanged).
- `ownIds = new Set(provenance.keys())`.
- `document = { ...toJSONOwn(model, ownIds), dependencies }` — **own-only**,
  persisted.
- `fullDocument = toJSON(model)` — the closure, retained on the outcome for
  presentation/annotation baking (Component 4).
- `classes = deriveClasses(document)` — enumerates **own** classes only, but each
  class's annotation enrichment (icon/label) is projected against `fullDocument`
  so base-inherited annotations still resolve. (`deriveClasses` gains an optional
  `annotationsFrom?: TodlDocument` param, defaulting to its enumeration document.)

`CompiledPackage` gains `fullDocument: TodlDocument` (closure) alongside
`document` (own-only). `BlobPackageStore.persist` continues to write
`pkg.document` (now own-only, with `dependencies`) and `pkg.sources` (already
own-only) — no store change beyond the new document contents.

### Component 3 — Plexus: record deps on publish

Meta-model and library `publish()` build `PackageRef[]` from the project's own
`BaseBindings` (exact versions from the manifest) and pass them to
`compilePackage`:

- **Meta-model:** typically `[]` — it only extends the auto-injected prelude.
- **Library:** `[{ kind: MetaModel, id, version }]` from `manifest.metaModel`,
  plus one `{ kind: Library, … }` per `manifest.libraries` entry.

No new manifest fields on the *project* — deps are derived from the existing
`BaseBindings` at publish time and recorded **in the package** (`model.json`
`dependencies`).

### Component 4 — Plexus: transitive `resolveBases`

`resolveBases` becomes a worklist walk:

```
seed queue with the project's direct bindings (metaModel, libraries)
visited = Set<`${id}@${version}`>
while queue non-empty:
  ref = dequeue; skip if visited; mark visited
  doc = read `<id>/<version>/model.json` from ref's backend  (meta-models | libraries)
  push doc.{nodes,edges} onto bases
  enqueue doc.dependencies (each tagged with its backend kind)
return { bases, problems }
```

- Backend routing by `PackageRef.kind` (meta-model vs library backend), same
  `ensure*Backend` seams as today.
- Dedup by `id@version` (visited set); TODL's `mergeBases` dedups any residual
  node overlap as a backstop.
- A missing/unpublished dependency → the existing "not published" `problems`
  string (now reachable transitively).
- Cycle-safe via the visited set.

## Data flow (library publish → arch consume)

1. **Library publish:** `resolveBases({metaModel: M@1})` (transitive; M has no
   deps → `[M]`) → `compilePackage([M.doc], libSources, id, [{MetaModel, M, 1}])`
   → persists `L/1/model.json` = own nodes/edges + `dependencies: [M@1]`.
2. **Arch consume:** project binds `M@1` + `L@1`. `resolveBases` walks:
   `M@1` (deps none) → `L@1` (deps `M@1`, already visited) → bases `[M, L]`,
   prelude auto-injected by `checkAgainst`. References resolve across the two
   own-only docs via stable ids.

## Error handling

- **Missing dependency:** collected in `problems` (unchanged contract) — a
  consuming project stays usable while a base is (re)published.
- **Version skew:** exact pins mean a base rev requires an intentional republish
  of dependents; no silent cross-version loading.
- **Cycles:** visited set breaks them; TODL `mergeBases` is first-wins.

## Migration & rollout

1. Land Components 1-4 in one TODL version + one Plexus version.
2. The transitive resolver is **backward-compatible**: an old full-closure
   `model.json` has no `dependencies` field → treated as a leaf → loads exactly
   as today (its baked closure still resolves; `mergeBases` dedups).
3. Republish every meta-model + library (they re-emit own-only + record deps).
   Order: meta-models first, then libraries. Small, dev-stage corpus.

## Testing

**TODL**
- `toJSONOwn`: excludes base + prelude nodes; keeps own→base cross-ref edges;
  drops base-internal edges.
- `compilePackage`: `document` own-only + carries `dependencies`; `fullDocument`
  is the closure; `classes` are own-only but annotation-enriched from the full
  model (a library class annotated with a meta-model annotation still gets its
  icon).
- `graphFromJSON` ignores `dependencies` (base-input contract unchanged).

**Plexus**
- `resolveBases` transitive: library → meta-model → prelude; dedup by
  `id@version`; a diamond (two libs sharing a meta-model) loads the meta-model
  once.
- Missing transitive dep → problem string.
- Cycle guard: mutually-referencing packages terminate.
- Round-trip: an arch project over own-only `M` + `L` validates with zero
  reference-undefined diagnostics (the acceptance test for the whole change).

## Out of scope

- Changing minted-id determinism (named ids are already stable; minted ids are
  own content).
- Dependency version *ranges* / resolution policy beyond exact pins.
- A sidecar `package.json` deps file — deps ride in `model.json` to keep
  `resolveBases` a single read per package.
