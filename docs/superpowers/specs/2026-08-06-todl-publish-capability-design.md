# TODL Publish Capability + Package Stores — Design

**Date:** 2026-08-06
**Status:** Draft — awaiting review.
**Component:** TODL (`@pragmatic-tech-ai/todl`), consumed by Plexus. Continues the "own it in TODL core" pattern established by the `.todl` model emitter migration (`emitModelTodl`): move the reusable *compile → derive → persist* spine out of the Plexus project factories and into TODL, behind injected persistence seams so TODL stays I/O-agnostic.

---

## 1. Vision

Publishing a **library** or **meta-model** project in Plexus today means: collect its `.todl` sources, compile them against the project's bases, gate on errors, serialize the compiled model, derive package metadata (the instantiable class list, annotations), and write a versioned bundle to a backend — then bake a mural presentation and copy resource folders. The two Plexus project factories hand-roll this, duplicating a compile-and-gate spine and a `toJSON` step that are pure TODL, plus reflection (`deriveClasses`) that is pure model/annotation traversal.

This design moves the reusable core into TODL as a first-class **publish capability**: `compilePackage` (compile + gate + derive, pure) and a **`PackageStore` family** (the persistence seam — the "several stores" family applied to publishing: a file/blob store now, a graph store as the Cypher/Dgraph sibling). Plexus delegates to it and keeps only what is genuinely its own: bundle-manifest shapes, mural presentation, and resource-folder I/O.

## 2. Mental model

- **A published package is the compiled model + its derived metadata.** `compilePackage` produces a self-describing `CompiledPackage`; a `PackageStore` decides *where and how* it is persisted. Compute and persistence are separate layers.
- **TODL never touches the filesystem.** As with the emitter (`emitModelTodl` returns a string) and `TodlFileStore` (`FileIO` seam), persistence flows through an **injected** seam — `PackageSink` for blobs, `GraphStore` for graphs. TODL gains no `fs`/electron dependency and runs unchanged in the Plexus renderer.
- **The store family is the point of extensibility.** `BlobPackageStore` reproduces today's on-disk layout (`<id>/<version>/model.json` + `src/<uri>`); `GraphPackageStore` writes the compiled graph into a `GraphStore`. Adding Dgraph later is a third store, not a rewrite.
- **Reflection belongs to TODL.** `deriveClasses` (instantiable clabjects → palette classes, with label + annotation-derived icon) is pure model/annotation traversal. It moves into TODL and uses TODL-internal annotation reflection.
- **Format is unchanged.** The persisted model artifact stays `model.json` (`toJSON(model)`), which existing consumers (`resolveBases` / the base-resolver) read. Persisting a model as `.todl` source remains a separate capability (the file store), not the publish artifact.

## 3. Architecture

```
 Plexus factory.publish(project, storage, provider)
        │  collect .todl sources (IStorage)            ── Plexus I/O
        ▼
 TODL: publish(bases, sources, store, opts)
        │
        ├─ compilePackage(bases, sources, opts)         ── pure, no I/O
        │     checkAgainst(bases, sources) → { model, diagnostics }
        │     errors = diagnostics.filter(Error)
        │     if errors → { ok:false, diagnostics, errors }         (never persists)
        │     else → CompiledPackage {
        │         id, version, name,
        │         document: toJSON(model),              ── the model.json
        │         sources,                              ── raw .todl passthrough
        │         classes:     deriveClasses(model),    ── reflection (moved in)
        │         annotations: deriveAnnotations(model) ── reflection (moved in)
        │     }
        │
        └─ store.persist(package)                       ── PackageStore family
              BlobPackageStore(sink)   → <base>/model.json + <base>/src/<uri>
              GraphPackageStore(graph) → compiled graph → GraphStore nodes/edges
        ▼
 Plexus: fold package.classes/annotations into library.json / manifest.json,
         scanResources(), bake presentation           ── Plexus packaging
```

## 4. Component A — `compilePackage` (`src/publish/publish.ts`)

Pure function; no I/O. Absorbs the duplicated `compileToDocument` spine from both factories plus the metadata reflection.

```ts
interface PackageIdentity { id: string; version: string; name?: string }

interface CompiledPackage extends PackageIdentity {
  document: TodlDocument;              // toJSON(compiled model) — the model.json
  sources: readonly SourceFile[];      // raw .todl passthrough (persisted under src/)
  classes: readonly PublishedClass[];  // instantiable palette classes (reflection)
}

interface CompileOutcome {
  ok: boolean;                         // false iff any Severity.Error diagnostic
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[];       // diagnostics filtered to Severity.Error
  package?: CompiledPackage;           // present iff ok
}

function compilePackage(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  identity: PackageIdentity,
): CompileOutcome
```

- **Compile + gate:** `checkAgainst(bases, sources)`; `errors = diagnostics.filter(d => d.severity === Severity.Error)`. If non-empty, return `{ ok:false, diagnostics, errors }` with no `package` — the orchestrator never persists a failing compile. (Meta-model publish, which compiles with no project bases, passes `bases: []`; `checkAgainst([], sources)` is equivalent to `check(sources)` with the prelude injected.)
- **Serialize:** `document = toJSON(model)`.
- **Reflect:** `classes = deriveClasses(model)` (Component D). Package-level annotations (needed only by the meta-model bundle manifest) are computed by the caller via the TODL-exported `projectAnnotations` — not carried on `CompiledPackage`, to keep it about the model, not any one manifest shape.

## 5. Component B — the `PackageStore` family (`src/publish/stores.ts`)

The persistence seam. A `PackageStore` decides how a `CompiledPackage` is stored; TODL ships two, and both are injected/adapter-backed so TODL owns no I/O.

```ts
interface PackageStore { persist(pkg: CompiledPackage): Promise<void> }

// The blob seam a file/object backend implements (Plexus adapts IStorage to it).
interface PackageSink {
  writeText(path: string, content: string): Promise<void>;
  writeBytes?(path: string, bytes: Uint8Array): Promise<void>;
}

// Writes the current on-disk layout: <base>/model.json + <base>/src/<uri>.
class BlobPackageStore implements PackageStore {
  constructor(sink: PackageSink, opts?: { layout?: (id: string, version: string) => string });
  // default layout: `${id}/${version}`
}

// Loads the compiled graph into a GraphStore (Cypher/Dgraph sibling).
class GraphPackageStore implements PackageStore {
  constructor(store: GraphStore);
}
```

- **`BlobPackageStore`** is the concrete path this migration ships. It writes `<base>/model.json` (`JSON.stringify(pkg.document, null, 2)`) and `<base>/src/<uri>` for each source — byte-for-byte the layout Plexus writes today. `writeBytes` is optional because publish itself emits only text; resource-folder copying stays in Plexus.
- **`GraphPackageStore`** reconstructs the compiled graph from `pkg.document` (`graphFromJSON`) and writes its nodes/edges into a `GraphStore`, proving the seam generalizes to the Cypher/Dgraph family. Fully fake-testable over `InMemoryGraphStore`; a real driver-backed target is gated on an available DB (same posture as `CypherGraphStore`).

## 6. Component C — `publish` orchestrator (`src/publish/publish.ts`)

```ts
interface PublishOutcome extends CompileOutcome { persisted: boolean }

async function publish(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  store: PackageStore,
  identity: PackageIdentity,
): Promise<PublishOutcome>
```

`compilePackage`; if `!ok`, return `{ ...outcome, persisted:false }` and do **not** call the store. Otherwise `await store.persist(outcome.package)`, return `{ ...outcome, persisted:true }`. The caller (Plexus) still owns everything downstream of persistence — folding metadata into its bundle manifest, resource scans, presentation.

## 7. Component D — reflection moves into TODL (`src/publish/reflect.ts`)

Pure model/annotation traversal, relocated from Plexus `library-bundle.ts` + `annotation-projection.ts`:

```ts
interface PublishedClass {
  id: string;        // qualified class NodeId
  concept: string;   // node.typeOf — the meta concept it realises
  label?: string;    // attrs.label
  icon?: string;     // annotation-derived icon path (bundle-relative)
}

function deriveClasses(model: TodlDocument): PublishedClass[]
// The relocated annotation reflection: walk `Annotated` edges out of a target
// to its application nodes, keyed by annotation name. Used by deriveClasses
// (per class, for the icon) and re-exported for Plexus's manifest shaping.
function projectAnnotations(model: TodlDocument, targetId: string): AnnotationMap
```

- `deriveClasses`: Instance-tier clabjects (`tier === 'Instance' && attrs.class === true`), reading `attrs.label` and an icon path via `projectAnnotations` (annotations are a TODL meta-kind — the `Annotated` edge walk `projectAnnotations` does today).
- `projectAnnotations` is a new TODL export, used internally by `deriveClasses`. This migration relocates only what `deriveClasses` needs: Plexus imports `deriveClasses` / `PublishedClass` from TODL and deletes its local copy, but keeps its own `projectAnnotations` for its *other* consumers (presentation, toolbox, entity-builder). Repointing those to the TODL export is a documented follow-on (§10), leaving a transient two-impl overlap (§11).
- Plexus's `LibraryBundleManifest` (classes + assets + docs + samples + presentation) stays in Plexus — it wraps the model metadata with packaging concerns.

## 8. Plexus integration

- **`compileToDocument` (both factories):** delegate to `compilePackage`, returning `{ doc: outcome.package?.document, problems: outcome.errors.map(...) }` (unchanged callers: `WorkspaceBaseResolver.compileToDocument`).
- **`publish` (both factories):**
  1. Collect sources via `collectTaxonomySources` / `collectTodlSources` (IStorage — unchanged).
  2. Build a `PackageSink` over the destination `IStorage` (~5-line adapter: `writeText`/`writeBytes` → `dest.WriteText`/`WriteBytes`).
  3. `await publish(bases, sources, new BlobPackageStore(sink), { id, version, name })`. `model.json` + `src/` are now written inside TODL.
  4. If `!persisted`, surface `outcome.errors` as the failure (as today).
  5. Fold `package.classes` into `library.json`; compute meta-model manifest annotations via Plexus's own `projectAnnotations`; run `scanResources`; bake presentation — all unchanged.
- **Delete** Plexus `deriveClasses` (import from todl). Plexus `projectAnnotations` stays for its other consumers (presentation, toolbox, entity-builder) — see non-goals.

## 9. Testing

- **`compilePackage` (headless):** clean sources → `ok`, `document` matches `toJSON(checkAgainst(...).model)`, `classes` derived; erroring sources → `!ok`, `errors` populated, no `package`.
- **`BlobPackageStore`:** fake in-memory `PackageSink` receives `<base>/model.json` (parses back to the document) + one `src/<uri>` per source, under the default and a custom layout.
- **`GraphPackageStore`:** over `InMemoryGraphStore`, every compiled node/edge lands; round-trips against `graphFromJSON(pkg.document)`.
- **`publish` orchestrator:** clean → `persisted:true` and the store received the package; erroring → `persisted:false` and the store was **not** called (spy sink records zero writes).
- **`deriveClasses` / reflection:** ported Plexus fixtures (clabject with label + annotation icon) reproduce the same `PublishedClass[]`.
- **Plexus:** existing library/meta-model factory + `library-bundle` tests stay green against the delegated path.

## 10. Scope / non-goals

- **In:** `compilePackage`, `publish`, the `PackageStore` family (`PackageStore`/`PackageSink` seams, `BlobPackageStore`, fake-tested `GraphPackageStore`), the `deriveClasses`/annotation reflection move, and the Plexus factory delegation.
- **Out (documented):**
  - **Persisted format stays `model.json`.** Not `.todl` source (would break `resolveBases`/base-resolver consumers). The `.todl` file store is a separate capability.
  - **Real graph-DB publish target.** `GraphPackageStore` is fake-tested; a driver-backed Cypher/Dgraph sink is gated on an available DB.
  - **Repointing Plexus's other `projectAnnotations` consumers** (presentation-generator, presentation-scaffold, toolbox-projection, meta-model-entity-builder) to TODL reflection — a follow-on consolidation; this migration only relocates what `deriveClasses` needs.
  - **Mural presentation + resource-folder copying** remain Plexus concerns (mural-coupled, IStorage I/O).
  - **Bundle-manifest shapes** (`library.json` / `manifest.json`) stay in Plexus — they mix model metadata with packaging/presentation fields.

## 11. Open questions / risks

- **Annotation reflection duplication (transient).** TODL gains annotation reflection for `deriveClasses` while Plexus keeps `projectAnnotations` for its presentation consumers — two impls until the follow-on consolidation. Acceptable (mirrors the emitter migration's transient before Plexus deleted its copy); the risk is drift, mitigated by porting Plexus's `annotation-projection` tests alongside the TODL reflection.
- **`PackageSink` vs full `IStorage`.** The sink is a deliberately minimal slice (`writeText`/optional `writeBytes`). If a future store needs read-back or listing, it grows a method rather than TODL importing `IStorage`.
- **Version bump + republish.** As with the emitter, TODL must be published (`0.16.0`) before Plexus can import the new symbols; Plexus bumps its floor in lockstep.
- **Meta-model with no bases.** `compilePackage(bases: [], …)` must match today's `check(sources)` behaviour (prelude-only); confirm the prelude injection in `checkAgainst([], …)` is identical.
