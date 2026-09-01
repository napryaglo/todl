# TODL Model Emitter + File Store — Design

**Date:** 2026-08-06
**Status:** ✅ Complete — implemented + merged + pushed to `main` (2026-08-06; 432/432 green, typecheck + build clean). `emit/todl.ts` (`deriveBindings`+`emitModelTodl`), `ModelDraft.toTodl()` (round-trips via `checkAgainst`, 0 diagnostics), `TodlFileStore`+`FileIO` seam (save/load a model as `.todl`, no `fs` dep, fake-tested). Note: dotted namespaces are flattened into a bare model id (`acme.app` → `acme-app-model`) since model ids must be bare identifiers. Deferred: re-opening a loaded `.todl` as an editable `ModelDraft`; a concrete `node:fs`/`IStorage` `FileIO` adapter; Plexus delegating its emitter to this one; the Dgraph backend.
**Component:** TODL (`@pragmatic-tech-ai/todl`). Completes the `ModelDraft.toTodl()` deferred in the typed-repository-clients Phase 4, plus a file-persistence backend. Downstream: Plexus (which already has an equivalent emitter and can drop its copy later).

---

## 1. Vision

A model authored through `ModelDraft` (typed-repository-clients Component D) should be **savable as `.todl` source code** to a file — human-readable, diff-able, version-controllable, and hand-off-able to an agent — and loadable back. This is the "file store" in a family of model backends: **file (`.todl` code)** now, **Cypher/Neo4j** already done (`CypherGraphStore`), **Dgraph** as future development.

The compiled-JSON path (`toJSON`/`fromJSON`) already exists and is lossless but machine-only. This design adds the **`.todl` text** path: a model emitter that turns a `ModelDraft`'s own delta into TODL source, round-tripping through the existing parser + `checkAgainst`.

## 2. Mental model

- **A model is saved as its OWN delta, not the whole graph.** The combined working graph also holds the meta-model, libraries, and prelude; those are bases, referenced by identity. Only the user's instances are emitted — inside a `model <id> : <metaModel> uses <lib…> { … }` block that names its bases.
- **`.todl` is interchange, not the live store** (spec §9). The live store is the combined `Repository`; `toTodl()` serializes the own delta; reload = `checkAgainst(baseDocs, [emitted])`.
- **File I/O is a seam.** TODL runs in Node AND the Plexus renderer, so it must not hardcode `node:fs`. A tiny `FileIO { read, write }` abstraction (mirroring the `CypherSession` seam) is backed by the consumer (`node:fs`, Plexus `IStorage`, …).
- **Reuse the proven emitter.** Plexus's `todl-emitter.ts` (`deriveBindings` + `emitInstances`) already emits round-trippable `.todl` for arch models. This design ports that capability into TODL core (so TODL stands alone) and drives it from a `ModelDraft`.

## 3. Architecture

```
 ModelDraft (own delta + combined model)
        │  toTodl()
        ▼
 emit/todl.ts:  deriveBindings(combined, baseIds, namespace)
                emitModelTodl(ownDoc, namespace, bindings) ──► .todl string
        │
        ▼
 TodlFileStore(io: FileIO, bases, {namespace})
        ├─ save(draft)  → io.write(draft.toTodl())
        └─ load()       → checkAgainst(baseDocs, [io.read()]) → { model, diagnostics }
```

## 4. Component A — the `.todl` model emitter (`src/emit/todl.ts`)

Pure functions over a `TodlDocument` (the own delta) + derived bindings; no I/O.

**`deriveBindings(model, baseIds, namespace)`** → `{ metaModel, uses, imports }` (ported from Plexus `deriveBindings`, sourced from the live combined model instead of base docs):
- **base namespaces** ← each base node's `namespace` attr, skipping the prelude namespace `todl`.
- **metaModel** ← the first sorted base namespace (fallback: `namespace`).
- **uses** ← every taxonomy whose term is the target of an own reference edge (term-drop scope); a term id is `<taxonomy>.<rest>` where `<taxonomy>` is a `Taxonomy` node.
- **imports** ← sorted base namespaces except `namespace`.

**`emitModelTodl(own, namespace, bindings)`** → `string` (ported from Plexus `emitInstances`):
```
namespace <namespace>
{
  import <imports…>;
  <top-level class declarations, if any>
  model <namespace>-model : <metaModel> [uses <uses…>] {
    <concept> <id> [instanceof <class>] {
      <scalar> = <literal>;
      <refMember> = <target>;            // single reference (target id kept whole)
      <refMember> = [<t1>, <t2>];        // many references
    }
    …
  }
}
```
- Instance own id / concept / `instanceof` class use the **local** (un-dotted) name; **reference targets keep their full id** (dotted for a taxonomy term or cross-namespace node, bare for a local own instance) — matching the type-directed model (todl ≥ 0.14, no sigil).
- Scalar attrs exclude the structural markers `class`, `id`, `namespace`.
- A `class`-marked own node emits a top-level `class <concept> <id> { … }` (classes are model-block-exempt); concrete instances live in the `model` block.

## 5. Component B — `ModelDraft.toTodl()`

`toTodl(): string` = `emitModelTodl(this.toJSON(), this.namespace, deriveBindings(this.model, this.baseIds, this.namespace))`. The own delta comes from the existing `toJSON()`; bindings derive from the combined model + base id set already on the draft. No new state on `ModelDraft` beyond what exists.

**Round-trip guarantee:** `checkAgainst(baseDocs, [{ path, content: draft.toTodl() }])` reconstructs the same own instances with zero new diagnostics. This is the emitter's correctness test.

## 6. Component C — `TodlFileStore` + `FileIO` seam (`src/authoring/file-store.ts`)

```ts
interface FileIO {
  read(): Promise<string>;
  write(content: string): Promise<void>;
}

class TodlFileStore {
  constructor(io: FileIO, bases: readonly Repository[], opts: { namespace: string });
  save(draft: ModelDraft): Promise<void>;                        // io.write(draft.toTodl())
  load(): Promise<{ model: Repository; diagnostics: Diagnostic[] }>; // checkAgainst(baseDocs, [io.read()])
}
```
- TODL owns only the `FileIO` interface; the concrete `node:fs` / `IStorage` adapter is a consumer concern (~5 lines), so TODL gains no dependency and stays environment-agnostic.
- `save` serializes the draft to `.todl` and writes it. `load` reads the `.todl`, reparses it against the bases, and returns the compiled model + diagnostics.
- Fully fake-tested (an in-memory `FileIO` holding a string); no filesystem needed to validate.

## 7. Testing

- **Emitter (headless):** `emitModelTodl` produces the expected `.todl` for a fixture own-delta (golden-ish string assertions on structure); `deriveBindings` derives the right metaModel/uses/imports from a namespaced base.
- **Round-trip:** author instances in a `ModelDraft` over a namespaced base → `toTodl()` → `checkAgainst(baseDocs, [todl])` → same instances, 0 diagnostics, references resolve.
- **File store:** `save` then `load` through a fake in-memory `FileIO` reconstructs the model.

## 8. Scope / non-goals

- **In:** the `.todl` model emitter, `ModelDraft.toTodl()`, `TodlFileStore` + `FileIO` seam, round-trip.
- **Out (documented):** re-opening a loaded `.todl` as an *editable* `ModelDraft` (load returns a compiled `Repository`; resuming authoring is a follow-on); a concrete `node:fs`/`IStorage` `FileIO` adapter (consumer concern); the Dgraph backend (future); predicate/invariant emission (the emitter emits data — instances + refs — not meta-model declarations).
- **Non-goal:** a general whole-graph `.todl` emitter (meta-models/libraries are authored, not machine-emitted); this emits *models* only.

## 9. Open questions / risks

- **Binding derivation without namespaces.** Bases built without a `namespace` attr (e.g. ad-hoc test fixtures) yield no base namespaces → `metaModel` falls back to the draft namespace and `imports`/`uses` are empty. Real published bases carry namespaces. The emitter must degrade gracefully (emit a valid `model … { }` with a fallback meta-model binding) rather than throw.
- **Reference-target form.** Emitting the full dotted target id relies on the loader resolving it (Plexus's emitter does this and round-trips); confirm the same holds driven from TODL core, and that `uses` scoping is emitted so bare-term resolution is available where the loader expects it.
- **Divergence from Plexus.** Plexus keeps its own `todl-emitter.ts`; once TODL owns the emitter, Plexus can delegate to it — a later consolidation, out of scope here.
