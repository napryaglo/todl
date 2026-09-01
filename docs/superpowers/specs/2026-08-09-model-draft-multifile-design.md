# TODL Multi-File Model Draft — Design (Sub-project 2b-2)

**Status:** Design. Authoring-draft half of SP2b (compiler half = SP2b-1, merged).
Parent: Plexus `docs/superpowers/specs/2026-08-09-viewpoint-multifile-architecture-model-design.md`.

**Date:** 2026-08-09

## 1. Goal

`ModelDraft` can compose SEVERAL `.todl` files into one editable overlay and emit
each file back — the seam SP3's `ArchitectureModelService` builds on. Round-trips
per file, preserving each entity's home file and each file's `conforms` viewpoint.

## 2. Design

### 2.1 `ModelDraft.fromSources` + per-node provenance
```ts
static fromSources(
  bases: readonly Repository[],
  sources: readonly { uri: string; text: string }[],
  opts: { namespace: string },
): ModelDraft
```
Compiles all sources together (`checkAgainst([...baseDocs], sources)`) and seeds
`own` with the non-base, non-model-container nodes/edges — exactly as `fromSource`
does for one source. Provenance: for each source, `parse` + `collectDefinitions`
→ a `home: Map<NodeId, uri>` (which file defined each id). New accessor
`homeOf(id): string | undefined`. `fromSource` stays (single-file).

### 2.2 `create` home hint
`create(concept, id, home?: string)` — records `home.set(id, home)` when given,
so a newly-authored entity lands in a chosen file. Existing 2-arg callers
unaffected (home undefined → falls to the draft's first/default file on emit).

### 2.3 `toTodlByFile(): Map<uri, string>`
Partition `own` by `homeOf` (nodes by their home; edges by their `from` node's
home; unmapped → a single default uri `${namespace}.todl`). For each file emit its
model block via `emitModelTodl`, passing the file's `conforms` viewpoint = the
shared per-entity `conforms` attr of that file's concrete entities (file↔viewpoint
1:1; undefined when none). `toTodl()` (single-file) delegates through the same
emit with the one conforms.

### 2.4 Emit the `conforms` clause (`src/emit/todl.ts`)
- `emitModelTodl(own, namespace, bindings, conforms?)` — when `conforms` is set,
  the model header emits `model <id> : <mm>[ uses …] conforms <V> {`.
- Add `"conforms"` to `MARKER_ATTRS` so the per-entity `conforms` attr is NOT
  emitted as an entity field (it is implied by the block's `conforms`).

## 3. File-by-file

| File | Change |
|------|--------|
| `src/authoring/model-draft.ts` | `fromSources`, `home` map + `homeOf`, `create` home hint, `toTodlByFile`, `toTodl` via shared conforms |
| `src/emit/todl.ts` | `emitModelTodl` conforms param; `MARKER_ATTRS += "conforms"` |

## 4. Tests

- `src/authoring/tests/model-draft-multifile.test.ts`:
  - `fromSources` composes two files → both entities present; `homeOf` maps each
    entity to its source uri.
  - `toTodlByFile` returns one entry per file; each file's text contains its
    entities and its `conforms <viewpoint>`; entity bodies carry no `conforms =`
    field.
  - **Round-trip:** `checkAgainst(bases, [...toTodlByFile entries])` reproduces
    the same entities with zero diagnostics.
  - `create(concept, id, home)` places a new entity into that home file's output.

## 5. Constraints

ESM strict; tests via `tsx --conditions=development --test`; real enums; tests in
`tests/` subfolders; `@pragmatic-tech-ai/todl@0.22.0` floor. Builds on SP2b-1
(per-entity `conforms` attr, same-id model-block merge).
