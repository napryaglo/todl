# Mutable ModelDraft + ArchInstanceModel Collapse — Design

**Date:** 2026-08-06
**Status:** Draft — awaiting review.
**Component:** TODL (`@pragmatic-tech-ai/todl`) ModelDraft, consumed by Plexus. Closes "Layer #3" of the Plexus-onto-new-TODL modernization and delivers the long-deferred "re-open a saved `.todl` as an editable draft."

---

## 1. Vision

TODL's `ModelDraft` is the typed authoring overlay (typed-repository-clients Component D), but it is **add-only**: it stages instances via the `Builder` onto one combined `Repository` built once in `on()`, with no way to edit a scalar, drop a reference, or delete an instance. Plexus's `ArchInstanceModel` is the mutable authoring model the `.archdiagram` canvas actually needs — and it reimplements, from scratch, everything `ModelDraft` does plus mutation, because `ModelDraft` couldn't do the job.

This design makes `ModelDraft` **mutable** (the pure, model-level mutation TODL should own) and slims `ArchInstanceModel` to a thin Plexus wrapper that keeps only the UI-reactive glue (`onChanged`) and id-allocation policy (`freshId`). The chosen split (from brainstorming): **mutation in TODL, reactivity in Plexus.**

## 2. Mental model

- **Why `ModelDraft` can't mutate today, and why `ArchInstanceModel` can.** TODL's `Graph`/`GraphStore` is add-only at the authoring surface: node-add, edge-add, node-remove — but no edge-remove and no attr-unset. `ArchInstanceModel` sidesteps this by never mutating a graph: it holds an own `TodlDocument` (`{nodes, edges}` arrays it fully controls), edits the arrays, and derives a `Repository` on demand for schema queries. This design **lifts that proven delta approach into `ModelDraft`.**
- **The own delta is the source of truth; the combined `Repository` is derived.** `ModelDraft` holds a mutable own `TodlDocument` over frozen base docs; the combined `model: Repository` (bases ∪ own) is built lazily and cached, invalidated on every mutation. Reads (`entity`, `has`, `diagnostics`, schema queries) go through the derived model; writes touch the own delta.
- **Bases stay frozen; only own instances are editable.** A mutator that targets a base id is a no-op / disallowed — you cannot edit the meta-model or a library from a draft.
- **Reactivity is a consumer concern.** `ModelDraft` mutation is synchronous and pure (no events). Plexus wraps it and fires its own `onChanged` after each call — TODL gains no Signal coupling in the authoring layer.

## 3. Architecture

```
 TODL ModelDraft (delta-based, mutable, pure)
   own: TodlDocument (mutable)        baseDocs: TodlDocument[] (frozen: prelude+bases)
        │                                   │
        └───────────── lazy ────────────────┘
                    model: Repository (bases ∪ own), cached; invalidated on mutation
   reads:  has / resolve / entity / ownInstances / diagnostics / referenceMembers
   writes: create / setField / addRef / removeRef / remove   (+ existing add)
   seed:   on(bases) [empty]   |   fromSource(bases, todlText) [reopen]
   emit:   toJSON (own delta)  |   toTodl (round-trippable source)

 Plexus ArchInstanceModel (thin wrapper)
   holds a ModelDraft; adds freshId(concept) + onChanged listeners;
   delegates create/setField/addRelationship/removeRelationship/remove + emit + referenceMembers,
   firing listeners after each mutation. The canvas DiagramMutator drives it unchanged.
```

## 4. Component A — `ModelDraft` goes delta-based (internal refactor)

`ModelDraft`'s public reads stay identical; the internals change from "one Repository built in `on()`" to "own delta + lazy combined Repository."

- **State:** `private own: TodlDocument`; `private readonly baseDocs: readonly TodlDocument[]` (`[preludeDocument(), ...bases.map(toJSON)]`); `private readonly baseIds: ReadonlySet<NodeId>`; `private modelCache?: Repository`.
- **`get model(): Repository`** — lazily `fromJSON` of (base nodes ∪ own nodes, deduped by id; base edges ∪ own edges), cached. Mirrors `ArchInstanceModel.repository()` (dedup by id / by edge identity before `fromJSON`, which rejects duplicates). A private `invalidate()` clears the cache; every mutator calls it.
- **`on(bases, {namespace})`** — store `baseDocs`, empty `own`. Signature unchanged (`readonly Repository[]`).
- **`toJSON()`** — returns the own delta directly (now trivial: it *is* `own`, minus any synthesized model-container node — see fromSource). `toTodl()` unchanged (`deriveBindings` + `emitModelTodl` over `own`).
- **Backward-compat gate:** all existing `model-draft.test.ts` + `model-draft-serialize.test.ts` cases stay green — `on()` resolves base nodes, `entity().field/ref`, `ownInstances`, `diagnostics`, `toJSON`/`toTodl`.

## 5. Component B — mutation API

```ts
create(concept: string, id: NodeId): Entity   // push an Instance node {attrs:{id}}; returns its handle
setField(id: NodeId, name: string, value: Scalar): void   // edit an OWN node's scalar attr
addRef(from: NodeId, member: string, to: NodeId): void     // append a Relationship edge (target must exist)
removeRef(from: NodeId, member: string, to: NodeId): void  // drop a matching Relationship edge
remove(id: NodeId): void                                   // drop an own node + every edge touching it
```

- **`add(descriptor)` keeps its fail-fast contract** (test: "add throws when a reference target does not exist"). In the delta model, `add`/`addRef`/`create` validate that each reference target exists in `baseIds ∪ ownIds` (∪ the id being added) and **throw** on a dangling target — no dangling refs are ever staged. `add` is re-expressed over the delta (`create` + `setField` + `addRef`) but preserves throw-on-missing-target.
- **Mutators target own nodes only.** `setField`/`remove` on a base id **throw** (bases are frozen — fail-fast, consistent with `add`). `removeRef` filters own edges; a base edge is never present in `own`, so it cannot be removed (a no-op if asked).
- Every mutator calls `invalidate()`.

## 6. Component C — `fromSource` (editable reopen)

```ts
static fromSource(bases: readonly Repository[], source: string, opts: { namespace: string }): ModelDraft
```

Compile `checkAgainst(baseDocs, [{ uri: `${namespace}.todl`, text: source }])`, then seed `own` with the non-base nodes/edges — stripping the synthesized `model`-container node (`typeOf === "model"`) and its `Contains` edges, exactly as `ArchInstanceModel.load` does today. An empty/blank source yields an empty draft. This is the deferred "re-open a loaded `.todl` as an editable `ModelDraft`."

## 7. Component D — `referenceMembers` (schema helper)

```ts
referenceMembers(fromId: NodeId, toId: NodeId): FieldSchema[]
```

The reference members of `fromId`'s concept that `toId` could fill — the concept-typed fields whose type `toId` is (or is a subtype of). Ported from `ArchInstanceModel.referenceMembers`: `model.effectiveSchema(fromConcept).fields.filter(f => compatible.has(f.type))` where `compatible = {toConcept} ∪ supertypesOf(toConcept)`. Primitive-typed fields fall out naturally.

## 8. Component E — Plexus `ArchInstanceModel` slims to a wrapper

`ArchInstanceModel` keeps its exact public API (the canvas + `ArchDiagramDocument` are unchanged) but delegates to an internal `ModelDraft`:

- Holds `private readonly draft: ModelDraft` (built via `ModelDraft.fromSource(bases, source, {namespace})` in `load`, wrapping its `TodlDocument[]` bases as `Repository`s via `new Repository(graphFromJSON(doc))`).
- **Keeps (Plexus-owned):** `freshId(concept)` (id-allocation policy → then `draft.create`), `onChanged(listener)` + the listener set, and the `mutated()` fan-out.
- **Delegates (to the draft):** `createInstance` (`freshId` + `draft.create`), `setField`, `addRelationship`→`addRef`, `removeRelationship`→`removeRef`, `remove`, `referenceMembers`, `repository()`→`draft.model`, `emit()`→`draft.toTodl()`, `node`/`document`/`ownInstances`. Each mutating method calls `mutated()` after delegating.
- Net: the ~90 lines of delta-manipulation + emit + schema logic in `ArchInstanceModel` collapse to thin forwards; the mutation/serialization/schema truth lives in TODL.

## 9. Testing

- **TODL — existing (regression):** all `model-draft.test.ts` + `model-draft-serialize.test.ts` + `file-store.test.ts` stay green through the delta refactor.
- **TODL — mutators:** `create` then `setField` reflects in `entity().field`; `addRef`/`removeRef` add/drop a ref (`entity().refs`); `remove` drops the node + its edges and from `ownInstances`; `setField`/`remove` on a base id is rejected; `addRef` to a missing target throws.
- **TODL — fromSource:** author a source, `fromSource` → same `ownInstances` + `diagnostics` clean; mutate a reopened draft; a blank source → empty draft. Round-trip: `fromSource(bases, draft.toTodl())` reproduces the own delta.
- **TODL — referenceMembers:** a concept-typed field matches a compatible target (incl. subtype); a primitive field never matches.
- **Plexus:** existing `architecture-instance-model.test.ts`, `arch-instance-roundtrip.test.ts`, `arch-canvas-ops.test.ts`, `arch-diagram-document.test.ts`, `drop-resolver.test.ts` stay green against the wrapper.

## 10. Scope / non-goals

- **In:** delta-based `ModelDraft` + mutators + `fromSource` + `referenceMembers`; Plexus `ArchInstanceModel` slimmed to a wrapper.
- **Out (documented):**
  - **Reactivity in TODL** — `ModelDraft` stays pure/synchronous; `onChanged` lives in Plexus (the chosen split).
  - **Deleting `ArchInstanceModel`** — it survives as the thin wrapper (id policy + reactivity), not removed.
  - **Editing base nodes** — bases are frozen; mutators touch own instances only.
  - **Undo/redo, transactions, batching** — out; mutators are immediate single ops.
  - **Graph-level edge-remove / attr-unset in `GraphStore`** — not added; the delta model makes it unnecessary here.

## 11. Open questions / risks

- **`add` re-expression must preserve fail-fast.** The single sharpest regression risk: today `add` throws via `builder.commit()` on a dangling target. The delta `add` must validate targets and throw identically — covered by the existing test and reasserted.
- **Lazy `model` cost.** Rebuilding the combined `Repository` on first read after each mutation mirrors `ArchInstanceModel` today (same cost profile), so no regression; canvas mutation batches already tolerate it. If profiling ever shows churn, an incremental combined graph is a later optimization.
- **Base wrapping at the Plexus seam.** `ArchInstanceModel` holds bases as `TodlDocument[]`; `ModelDraft.on/fromSource` take `Repository[]`. Plexus wraps via `new Repository(graphFromJSON(doc))`. If that boundary proves noisy, a `TodlDocument[]`-accepting overload is a trivial add — deferred until it earns itself.
- **No version churn for consumers other than Plexus.** The refactor is internal + additive; `add`/`model`/`entity`/`toJSON`/`toTodl` signatures are unchanged, so generated authoring clients need no change. New TODL minor (`0.17.0`) ships the additions; Plexus bumps in lockstep.
