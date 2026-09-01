# Namespace-Scoped Name Resolution — Design

**Date:** 2026-08-04
**Status:** ✅ Finished
**Package:** TODL (`@pragmatic-tech-ai/todl`), consumed by Plexus/Mural via Verdaccio

## Problem

Two reported defects in the `uses` clause, which on investigation are one
underlying gap:

1. `uses ns.tax` (a qualified/namespaced target) fails to **parse** —
   `uses` reads a single bare identifier ([parser.ts:499](../../../src/parse/parser.ts#L499)),
   chokes on the `.`.
2. `uses` (and every reference) does not **resolve through `import` clauses**.

Root cause: TODL node ids are **flat and global**. `setNamespace` only
stamps a `namespace` *provenance attr* ([builder.ts:53](../../../src/model/builder.ts#L53));
a taxonomy `categories` in `namespace ea` has node id `categories`, not
`ea.categories`. Consequences:

- Every declaration is visible everywhere by its bare id. `import` clauses
  are parsed into `NamespaceNode.imports` but **never consulted** — vestigial.
- `uses categories` "works" only because `categories` is globally visible,
  regardless of whether the referencing namespace imported it.

The real corpus already *writes* namespace-aware code expecting imports to
matter: `libraries/microsoft` is `namespace libraries.microsoft` with
`import tech-architecture;`, referencing `location` / `technology` /
`categories` from `tech-architecture`. The intent is there; the language
ignores it.

## Decision (from brainstorming)

- **Reach:** ALL reference resolution becomes namespace-scoped (not just `uses`).
- **Ids:** stay **flat**; namespace is a resolution **filter** (provenance +
  imports), not an id prefix. Two namespaces may NOT define the same bare id
  (the builder already forbids duplicate ids) — so a bare id is globally
  unique and there is never resolution *ambiguity*; the filter is purely a
  **visibility gate**.
- **Rollout:** **hard cutover** — a reference whose target namespace is not
  reachable is an error immediately; migrate the corpus in the same change.

## Design

### Reachability

Every reference has a **home** = the namespace of the file/declaration it
sits in, plus that file's `import` list. Define the reachable namespace set
for a reference whose home file declares namespace `N` with imports `I`:

```
reachable(N, I) = { N } ∪ I ∪ GLOBAL
```

- `GLOBAL` = the always-visible scope: any **namespace-less** declarations
  (a raw `load` with no `namespace` wrapper), plus the **prelude / default
  library**. The prelude declares `namespace todl`, so it is not namespace-less;
  instead its symbols are recognized via the `reserved` set (the prelude names
  `check()`/`checkAgainst()` already inject) and are implicitly reachable
  everywhere — `string`, `element`, `icon`/`toolbox` annotations, … — without
  an `import todl`.
- Imports are **file-scoped** (each file declares its own imports) and
  **non-transitive** (importing `ea` does not re-export what `ea` imports).
- A reference always sees **its own namespace** `N` without an import.

### Resolution of a reference string

A reference id may be dotted for three distinct reasons: a flat term id
(`categories.platform-api`), a namespace-qualified name
(`tech-architecture.categories`), and namespaces themselves may be dotted
(`libraries.microsoft`). Resolve a reference `ref` at a site with home
`(N, I)` against the set of all defined + base node ids:

1. **Unqualified / flat-id match.** If `ref` is a global node id, that node
   is the candidate. Apply the **visibility gate**: resolve iff
   `nodeNamespace(candidate) ∈ reachable(N, I)`. If the node exists but its
   namespace is not reachable → `reference.unreachable` (message names the
   namespace and suggests `import <ns>`). This branch also covers the
   existing taxonomy-scoped bare rewrite (sibling / `uses`), which now runs
   its `has()` through the visibility gate.
2. **Qualified match.** Else split `ref` into `prefix` + `rest` at each
   segment boundary `k = 1 … segs-1` (shortest prefix first). If a global
   node with id `rest` exists AND `nodeNamespace(rest) === prefix`, resolve
   it — **qualified access needs no import** (explicit cross-namespace
   reference). First matching split wins; ids are unique so at most one
   `rest` exists per split string.
3. Else `reference.undefined` (as today).

`nodeNamespace(id)` = the source declaration's home namespace (from the
loader `units`) or, for a base node, its `namespace` provenance attr;
`null` for prelude / namespace-less nodes (always reachable).

Worked examples (home = `libraries.microsoft`, imports `tech-architecture`):
- `location` → flat node `location`, namespace `tech-architecture` ∈ reachable → OK.
- `categories.platform-api` → flat term node, namespace `tech-architecture` reachable → OK.
- `tech-architecture.categories` (no import needed) → step 2: `rest=categories`, ns matches → OK.
- a ref to `x` in an un-imported namespace → step 1 finds the node but gate fails → `reference.unreachable`.

### Parser: accept qualified names at reference sites

The **visibility gate applies to every reference regardless of the parser** —
it works on the bare id as-written, so import-honoring needs no parser change.
Qualified-name *writing* only matters where a user types `ns.x`; this change
enables it for the **reported taxonomy clauses**, `represents` and `uses`
([parser.ts:488](../../../src/parse/parser.ts#L488), [:499](../../../src/parse/parser.ts#L499)),
swapping `expect(Identifier)` → `parseDottedPath()`. `&refs` / value names
already accept dotted paths (so `ea.categories.platform-api` in a value works).

Qualified *writing* at the other reference sites (record concept, `instanceOf`,
field/param type, model bindings) is a **scoped follow-up** — their gate
already works via bare name + import; only the `ns.x` literal form is not yet
parsed there. Declaration-name sites stay bare.

### Diagnostics

- **New** `DiagnosticCode.ReferenceUnreachable` (severity Error): "reference
  to \"x\", which is defined in namespace \"ea\" but not imported here — add
  `import ea;`". Distinct from `reference.undefined` (no such node anywhere)
  so migration is mechanical.
- `TaxonomyUsesUndefined` becomes visibility/qualifier-aware (resolves the
  `uses` target through the same algorithm; the ambiguity code is unaffected
  since ids stay unique).

### Loader threading (implementation shape)

- `units` carries `{ ns, imports, decl }` (imports from `result.namespace.imports`).
- `RefSite` gains the home `(ns, imports)` (threaded through `collectNames` /
  `collectValueRefs`); the taxonomy `scope` already threads — extend it.
- `has(id)` splits into `exists(id)` and `reachableFrom(id, home)`; the
  resolution loop applies the gate + the qualified-split fallback.
- `nodeNamespace`: a `Map<id, ns>` built from `units` for source decls, plus
  `node.attrs.get("namespace")` for base nodes.

## Migration (hard cutover — done in this change)

The real corpus is largely already compliant:

- **microsoft library** — `namespace libraries.microsoft` already
  `import tech-architecture;` and references only that + prelude. Expected to
  validate green unchanged; the resolved model is identical (same nodes, now
  reached via import instead of flat-global), so **no republish needed** —
  verify by recompiling `microsoft.todl` against the meta-model base and
  diffing the emitted model.json (must be byte-identical).
- **tech-architecture meta-model** — a single namespace (`tech-architecture`,
  40 files); intra-namespace refs + prelude only → green unchanged; verify.
- **TODL's own test suite** — the real migration surface: inline TODL that
  crosses namespaces WITHOUT an import (e.g. `taxonomy-bare-resolution.test.ts`
  bases in `namespace ea`, consumer in `namespace lib` using bare `categories`).
  Each such test gets an `import ea;` added to the consumer, OR is restructured;
  a few negative tests assert the new `reference.unreachable`. Sweep every
  `*.test.ts` under `src/` that compiles multi-namespace inline TODL.

Migration procedure: implement → run the full TODL suite → for each failing
test, add the missing `import` (or convert to a `reference.unreachable`
assertion where that's the point) → green → recompile the userData corpus and
diff → only republish if a model.json actually changed.

Downstream: publish TODL minor bump; bump `@pragmatic-tech-ai/todl` in Plexus (and
Mural if it depends). Any Plexus in-app authored models that cross namespaces
without imports will newly error and need an `import` — surfaced in the
Problems panel; documented in the release note.

## Testing

- **Resolution unit tests** (`src/parse/tests/`): bare ref reachable via import
  → OK; same ref without the import → `reference.unreachable`; qualified
  `ns.x` with no import → OK; qualified with wrong ns → undefined; prelude
  always reachable; namespace-less decls reachable; dotted-namespace qualifier
  (`libraries.microsoft.foo`) resolves; term-id vs qualified disambiguation
  (`categories.platform-api` resolves as the flat term, not `categories`.`platform-api`).
- **Parser tests**: `uses ns.tax` / `represents ns.c` / qualified field type
  parse into dotted strings; bare forms still parse.
- **`uses` tests**: qualified `uses ns.tax` resolves; bare `uses tax` via
  import resolves; `uses tax` without import → error.
- **Corpus regression**: compile microsoft + meta-model, assert 0 errors and
  identical emitted model.json.

## Out of scope

- Qualifying node ids (rejected — flat ids retained).
- Making imports transitive / re-exportable.
- Namespace aliases (`import ea as e;`).
- Any Plexus/Mural UI for imports beyond existing Problems reporting.

## Rollout

TODL: implement + migrate tests + verify corpus → full suite green → publish
minor → bump Plexus (+ Mural if needed). Per the repo rule, merge to main when
publishing.
