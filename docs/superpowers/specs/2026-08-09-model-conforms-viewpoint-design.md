# TODL `model … conforms <viewpoint>` — Design (Sub-project 2a)

**Status:** Design. First half of sub-project 2 of the viewpoint-scoped
architecture model (parent: Plexus `docs/superpowers/specs/
2026-08-09-viewpoint-multifile-architecture-model-design.md`). SP2b (multi-file
shared-model draft) follows.

**Date:** 2026-08-09

## 1. Goal

Add an optional `conforms <viewpoint>` clause to a `model` declaration:

```
model <id> : <meta-model> [uses <lib>, …] [conforms <viewpoint>] { <objects> }
```

`conforms V` scopes what the model **homes**: every concrete object it contains
must have a concept **framed by** `V` (subtype-aware). It is validation-only in
SP2a — the home-routing it enables is used by SP2b/SP3.

Depends on SP1's viewpoint construct (merged, published `@pragmatic-lab/todl@0.22.0`).

## 2. Scope

**In:** parse the clause; resolve it to a viewpoint; store it on the model node;
validate that every contained concrete object's concept is framed by the
conformed viewpoint.

**Out (deferred to SP2b):** round-trip emit of `conforms` (belongs with
`toTodlByFile`); the "conforms REQUIRED once a model is split across files" rule
(needs multi-file provenance); multi-file composition.

## 3. Design — mirror the model `uses`/`libraries` binding

### 3.1 Parser & AST
- `ModelDecl` (`src/parse/ast.ts`) gains `conforms: string | null` and
  `conformsSpan?: SourceSpan`.
- `parseModel` (`src/parse/parser.ts`) — after the `uses` block and before the
  `{`, parse an optional clause:
  ```ts
  let conforms: string | null = null;
  let conformsSpan: SourceSpan | undefined;
  if (this.checkKeyword("conforms")) {
    this.advance();
    const cStart = this.current();
    conforms = this.parseDottedPath();   // viewpoint may be ns-qualified
    conformsSpan = this.spanFrom(cStart);
  }
  ```
  Set `decl.conforms = conforms` and `decl.conformsSpan` on the returned node.
  Existing models (no clause) get `conforms: null`.

### 3.2 Loader
- **Resolution loop** — mirror the model `libraries` loop (loader.ts ~174-193):
  for each model with a non-null `conforms`, `resolveRef` it against the unit's
  `Home`, rewrite a qualified `ns.V` to flat in place (`decl.conforms = flat`),
  and require the resolved id to be a **viewpoint** (an `isViewpoint` helper
  parallel to `isTaxonomy`: source-declared viewpoint OR
  `model.resolve(id)?.typeOf === MetaKind.Viewpoint`). On failure emit
  `ModelConformsNotViewpoint` (unreachable vs not-a-viewpoint message variants,
  paralleling `TaxonomyUsesUndefined`).
- **`applyModel`** (loader.ts ~643) — store the binding as a node attr, next to
  `MetaModel`/`uses.*`: `if (decl.conforms !== null) builder.setField(decl.id, "conforms", decl.conforms);`.
- **`recordSpans`** Model case — record `conformsSpan` via
  `Repository.memberKey(decl.id, "conforms")` when present.

### 3.3 Validation (`src/validate/validate.ts`, `validateModel`)
- Read `node.attrs.get("conforms")`. If a string `V`:
  for each contained CONCRETE object (`closure(node.id, Contains, Out)` filtered
  to `attrs.class !== true`), require the conformed viewpoint to frame its
  concept — `model.viewpointsFraming(obj.typeOf).includes(V)`. Otherwise emit
  `ModelEntityNotFramed` (`entity "<id>" is a <concept>, not framed by
  viewpoint "<V>"`). Subtype-awareness comes for free via `viewpointsFraming`
  (it walks supertypes).

### 3.4 Diagnostics (`src/diagnostics/diagnostic.ts`)
- `ModelConformsNotViewpoint = "model.conforms-not-viewpoint"`
- `ModelEntityNotFramed = "model.entity-not-framed"`

## 4. File-by-file

| File | Change |
|------|--------|
| `src/parse/ast.ts` | `ModelDecl.conforms` + `conformsSpan` |
| `src/parse/parser.ts` | parse optional `conforms <viewpoint>` in `parseModel` |
| `src/parse/loader.ts` | conforms resolution loop; `applyModel` store; `recordSpans`; `isViewpoint` helper |
| `src/validate/validate.ts` | framing check in `validateModel` |
| `src/diagnostics/diagnostic.ts` | two new `DiagnosticCode`s |

## 5. Tests

- `src/parse/tests/model-conforms-parse.test.ts` — `model M : mm conforms V {}`
  parses `conforms: "V"`; `model M : mm uses t conforms V {}` (clause order);
  a model with no clause has `conforms: null`; qualified `conforms ns.V`.
- `src/parse/tests/model-conforms-load.test.ts` — conforms stored as the model
  node's `conforms` attr; qualified rewrites to flat; `conforms` of a
  non-viewpoint (e.g. a concept/taxonomy) → `ModelConformsNotViewpoint`;
  unknown viewpoint → `ModelConformsNotViewpoint`.
- `src/validate/tests/model-conforms-validate.test.ts` — an entity whose concept
  is framed by the conformed viewpoint is clean; an entity of a non-framed
  concept → `ModelEntityNotFramed`; a subtype of a framed concept is clean
  (subtype-aware); a model with no `conforms` imposes no framing constraint.

## 6. Constraints

- ESM, strict tsconfig; tests via `tsx --conditions=development --test "src/**/*.test.ts"`.
- Real TS enums; extend existing `DiagnosticCode`.
- Every test file in a `tests/` subfolder next to source.
- `@pragmatic-lab/todl@0.22.0` (SP1) is the floor — `MetaKind.Viewpoint`,
  `Repository.viewpointsFraming` exist.
