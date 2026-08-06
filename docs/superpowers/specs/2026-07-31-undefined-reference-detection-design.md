# Undefined-Reference Detection — Design

**Date:** 2026-07-31
**Status:** ✅ Finished
**Repo:** TODL (`@pragmatic-lab/todl`)

## Goal

The loader must resolve every referenced symbol and emit an **Error** diagnostic
for any reference that resolves to neither a locally-defined declaration nor a
node already present in the model (a base node under `checkAgainst`) — instead of
silently stubbing an `UNRESOLVED` placeholder node.

## Background — current behavior

`loadInto()` (`parse/loader.ts`) collects `defined` and `referenced` name sets up
front (`collectNames` → `collectInstanceNames` → `collectValueRefs`), then at
line 144:

```ts
for (const id of referenced) {
  if (!defined.has(id) && !model.has(id)) first.assertInstance(UNRESOLVED, id);
}
```

Every referenced-but-undefined id becomes an `Instance`-tier node with
`typeOf = "unresolved"`. This is deliberate today (the loader header notes
fixtures reference `lane`/`event-trigger`/… without defining them), and the stub
is what lets edges to those ids satisfy `commit()`'s target-exists invariant.

Two facts established during design:

1. **Nothing inside TODL consumes `unresolved` nodes.** Only `loader.ts` produces
   them; `validate`, `emit`, `language-service`, and `language-server` never read
   the `unresolved` typeOf. (The `TaxonomyValueUnresolved` diagnostic is unrelated
   — a taxonomy-value check, not the node typeOf.) The only external consumers are
   downstream `model.json` readers (Mural/Plexus).
2. **`commit()` throws on a dangling edge** (`model/builder.ts:192-194`:
   `edge target "…" does not exist`). The `UNRESOLVED` stub is precisely what keeps
   edges to undefined ids valid. So dropping the stub requires *not staging* those
   edges, or `commit()` crashes.

## Decisions (from brainstorming)

- **Semantics:** a referenced-but-undefined symbol is **always an Error**, and the
  `UNRESOLVED` stub is **dropped** (no phantom node). Chosen over "keep the stub +
  diagnose" and "opt-in strict mode".
- **Where:** entirely in `loadInto()` — it owns both the reference sites and the
  `Diagnostic[]` channel, and knows base-model membership via `model.has(id)`.
  `validate` is too late (the sites' spans are gone by then).
- **Granularity:** one diagnostic **per reference site** (two references to the
  same missing id → two diagnostics).

## Architecture & mechanics

### Reference-site tracking

Replace the bare `referenced: Set<string>` with a list of **reference sites**:

```ts
interface RefSite {
  id: string;              // the referenced symbol
  span: SourceSpan | null; // the reference location (see span sourcing below)
  node: NodeId | null;     // the referencing node id (Diagnostic.node)
  path: string | null;     // concept-qualified member path when applicable, else null
}
```

`defined` stays a `Set<string>`. `collectNames`/`collectInstanceNames`/
`collectValueRefs` gain a `sites: RefSite[]` out-param (replacing the
`referenced` set) and push one `RefSite` per reference.

**Span sourcing** (reference AST varies):
- Value `Ref`/`Name` (instance/term assignments) — the `ValueNode`'s own span;
  `node` = the owning instance/term id, `path` = the assignment's member path.
- Instance `instanceOf` — the instance declaration's span; `node` = the instance
  id, `path` = `null`.
- Concept `extends` — the concept declaration's span; `node` = the concept name.
- Taxonomy `represents` (bare strings) — the taxonomy declaration's span;
  `node` = the taxonomy name.

Where a finer span is unavailable (bare-string references on a declaration), the
enclosing declaration span is used — a correct, if coarser, location.

### Resolution + drop-the-stub

After collection, compute the undefined set and diagnose:

```ts
for (const site of sites) {
  if (!defined.has(site.id) && !model.has(site.id)) {
    diagnostics.push({
      code: DiagnosticCode.ReferenceUndefined,
      severity: Severity.Error,
      message: `reference to undefined symbol "${site.id}"`,
      span: site.span,
      node: site.node,
      path: site.path,
    });
  }
}
```

Build an `undefinedIds = new Set<string>()` of the ids that failed resolution.
Then:

1. **Remove** the `assertInstance(UNRESOLVED, id)` loop (no stub node).
2. **Skip edges to undefined targets.** Each loader site that stages an edge
   whose target is a referenced id — instance `instanceOf` (InstanceOf edge),
   value `Ref`/`Name` (Relationship edges), concept `extends` (Extends edge),
   taxonomy `represents` (Represents edge), and term relationships — is guarded:
   if the target ∈ `undefinedIds`, the edge is not staged. `commit()`'s
   target-exists invariant is left intact (still a genuine-bug guard).
3. The **referencing node is still created** (it is defined). E.g. `foo instanceOf
   bar` with undefined `bar` → node `foo` exists (its `typeOf = "bar"` attr
   remains; the diagnostic flags `bar`), but no `InstanceOf` edge is staged.

### New diagnostic code

Add to `DiagnosticCode` (`diagnostics/diagnostic.ts`), in the instance-loading
group:

```ts
ReferenceUndefined = "reference.undefined",
```

## Fallout — existing tests/fixtures

Each flips from "expect `UNRESOLVED` node" to "expect Error + no node":

- **`parse/tests/loader.test.ts:58`** ("undefined references become unresolved
  placeholder nodes") → rewrite: assert a `ReferenceUndefined` diagnostic and
  that `model.resolve("message")` is `undefined`.
- **`tests/check-against.test.ts:61`** (asserts `nonsense.ghost` stubs to
  `"unresolved"`) → rewrite: when the id is in neither sources nor bases, expect
  the `ReferenceUndefined` diagnostic and no node.
- **`language-service/tests/analysis.test.ts:33`** and
  **`language-server/tests/server-bases-multiproject.test.ts`** — currently lean
  on a stubbed reference; update so the reference either resolves via its base
  (their actual intent) or expects the new diagnostic.
- **Fixture `.todl` files** that intentionally under-define
  (`parse/tests/fixtures/concepts.todl`, `order-fulfillment.todl`, etc. — the
  `lane`/`event-trigger` references) → **define the missing symbols** so each
  fixture is a complete model, unless a specific test wants the error. Loader
  header comment (`parse/loader.ts:5-7`) updated to match the new behavior.
- **`model/tests/builder.test.ts:40`** ("commit is atomic … unresolved target
  aborts") — **unchanged**; `commit()` keeps throwing on a genuinely-dangling
  edge, which the loader now never stages.

## Testing (new)

- One test per reference kind — undefined `instanceOf`, `extends`, taxonomy
  `represents`, value `Ref`, value `Name` — each asserting: a `ReferenceUndefined`
  diagnostic at the reference span, the referencing node still resolves, and no
  edge/stub to the missing id exists.
- **No false positive:** a reference resolved via a base model under
  `checkAgainst` produces no diagnostic.
- **Load still succeeds:** an undefined reference does not throw from `commit()`
  (edges to it were skipped).
- **Per-site count:** two references to the same undefined id yield two
  diagnostics.

## Downstream note

The published `tech-architecture` meta-model currently carries 13 `unresolved`
instance nodes — genuine undefined references this feature surfaces as errors.
That is the intended outcome (the author defines the missing symbols); it is
called out because it changes what that model compiles to and will make it fail
validation until fixed.
