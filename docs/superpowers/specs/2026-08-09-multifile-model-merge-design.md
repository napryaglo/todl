# TODL Multi-File Model Merge — Design (Sub-project 2b-1)

**Status:** Design. Compiler half of SP2b (parent: Plexus `docs/superpowers/
specs/2026-08-09-viewpoint-multifile-architecture-model-design.md`). The draft
layer (`fromSources`/`toTodlByFile`/provenance/emit) is SP2b-2.

**Date:** 2026-08-09

## 1. Goal

Let ONE model be split across several `.todl` files (Option B): same namespace,
same `model` id, each file's block `conforms` to its own viewpoint. Compiling
the files together composes them into one model — no duplicate-node crash — and
each file's entities validate against THAT file's viewpoint.

Discovered empirically: two same-id `model` blocks currently throw
`node "<id>" already exists` at `Builder.commit`; and SP2a's per-model-node
`conforms` attr can't represent two files conforming to different viewpoints.

## 2. Design

### 2.1 Merge same-id model blocks (`src/parse/loader.ts` `applyModel`)
Guard the model-node assertion with the existing `asserted` set (as instances
already dedup): assert + set model-level fields only on first sight; on
subsequent blocks with the same id, skip the node assertion but still process
the block's instances. Result: one model node, all files' entities Contained.

### 2.2 conforms → per-entity home viewpoint
`conforms` moves from the model node to each concrete entity. In `applyModel`,
when a block has `conforms V`, stamp every concrete (`!isClass`) top-level entity
it contains with a `conforms` attr = `V`. Different files → different per-entity
viewpoints on one merged model. (Model-node `conforms` storage from SP2a is
removed.)

### 2.3 Validation moves to per-entity (`validateModel`)
Replace SP2a's model-node framing loop with a per-entity one: for each contained
concrete entity carrying a `conforms` attr `V` (where `V` resolves to a
viewpoint), require `viewpointsFraming(entity.concept)` to include `V`, else
`ModelEntityNotFramed`. Single-file and multi-file are then uniform.

### 2.4 `conforms` required once split
Thread each source's `uri` through the loader `units`. Group model blocks by
`id`; if a model id is contributed by MORE THAN ONE distinct source uri and any
contributing block has `conforms === null`, emit
`ModelConformsRequiredWhenSplit` on that block. Single-file models may omit
`conforms` (unchanged).

## 3. File-by-file

| File | Change |
|------|--------|
| `src/parse/loader.ts` | thread `uri` into `units`; `applyModel` merge + per-entity conforms stamp; conforms-required-when-split check |
| `src/validate/validate.ts` | per-entity framing loop (replaces model-node loop) |
| `src/diagnostics/diagnostic.ts` | `ModelConformsRequiredWhenSplit` |
| `src/parse/tests/model-conforms-load.test.ts` | assert entity-level `conforms` attr (was model-node) |

## 4. Tests

- `src/parse/tests/multifile-model-merge.test.ts` — two same-namespace files each
  `model Arch conforms <different VP>` compose into one `Arch` model with both
  entities and NO duplicate-node error; each entity carries its own `conforms`.
- conforms-required: two files contributing to `Arch`, one omits `conforms` →
  `ModelConformsRequiredWhenSplit`; a single-file model without `conforms` is
  clean.
- `src/validate/tests/model-conforms-validate.test.ts` (SP2a) — still green
  (per-entity path); multi-file: fileB's `Node` under DeploymentView is clean,
  under ComponentView is `ModelEntityNotFramed`.
- Update `model-conforms-load.test.ts` to read the entity `conforms` attr.

## 5. Out of scope (SP2b-2)

`ModelDraft.fromSources`, `toTodlByFile`, per-node uri provenance for round-trip,
`create` home hint, and `conforms`-clause emit.

## 6. Constraints

ESM strict; tests via `tsx --conditions=development --test`; real enums; tests in
`tests/` subfolders; `@pragmatic-lab/todl@0.22.0` floor.
