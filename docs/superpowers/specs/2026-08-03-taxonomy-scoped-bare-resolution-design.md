# Taxonomy-Scoped Bare Reference Resolution — Design

**Status:** Design approved 2026-08-03. Ready for an implementation plan.

**Goal:** Let a taxonomy reference terms by their **bare** (unqualified) name —
sibling terms implicitly, and other taxonomies' terms via an explicit `uses`
clause — so hand-authored and machine-migrated taxonomies don't have to qualify
every reference with `<taxonomy>.<term>`.

**Tech Stack:** `@pragmatic-lab/todl` (TypeScript, ESM). Parser + AST + loader +
validator + formatter.

---

## Problem

TODL taxonomy terms have taxonomy-qualified node ids: `location azure` inside
`taxonomy microsoft-tech` is the node `microsoft-tech.azure`. Every reference must
use that dotted id; a bare `azure` resolves to nothing (`reference.undefined`).

This bit the YAML→TODL migration hard. `plexus_tests/libraries/microsoft/microsoft.todl`
uses bare references throughout — `parent = azure`, `available-in = [m365]`
(sibling terms), and `applicable-to = [platform-api]` (a term of the *other*
taxonomy `categories`, in the meta-model). Compiled against its base, that one
file produces **518 `reference.undefined` errors**. The migration also emitted a
legacy `uses categories` clause on the taxonomy header, which is not valid grammar
today and, via parser error-recovery, actually **crashes** the compile — silently
masking the 518 errors when Plexus swallows the exception.

## Goal / Success Criteria

- A bare reference inside a term body resolves to a **sibling** term of the same
  taxonomy with no annotation.
- A taxonomy may declare `uses <tax>, …`; bare references then also resolve
  against those taxonomies' terms.
- `microsoft.todl` compiles clean **as written** (no rewrite of its references).
- Nothing that resolves today changes meaning; qualified references still work.
- The `uses` clause round-trips through the formatter.

## Design

### 1. Sibling resolution (implicit)

A bare identifier appearing as a reference value inside a term body first resolves
against the **enclosing taxonomy's own terms**. Inside `taxonomy microsoft-tech`,
`parent = azure` resolves to `microsoft-tech.azure`. No clause required.

### 2. Cross-taxonomy scope — the `uses` clause

```todl
taxonomy <name> : represents <c1>[, <c2>…] [uses <tax1>[, <tax2>…]] {
    <terms>
}
```

`uses` names other taxonomies whose terms are brought into bare scope for this
taxonomy's term-body references. `uses` targets are resolved in the **merged
model** (bases + own), so a taxonomy defined in a base (e.g. `categories` in the
`tech-architecture` meta-model) is a valid target from a downstream library.

`uses` on a taxonomy is a distinct meaning from `uses` on a `model` (which binds
libraries to a model's instance-construction scope). Both read as "draws names
from"; the keyword is intentionally shared.

### 3. Resolution order

For a bare name `N` used as a reference value inside taxonomy `X`, first match wins:

1. **Sibling** — `X.N`. (Most-local; silently shadows any `uses` match.)
2. **Used taxonomy** — `Y.N` where `Y` is in `X`'s `uses` list. If **exactly one**
   used taxonomy defines `N`, resolve to it. If **two or more** do →
   `taxonomy.ambiguous-bare-reference` diagnostic ("`N` is defined by both `a` and
   `b`; qualify it as `a.N` or `b.N`").
3. **Existing resolution** — the current bare check (top-level concepts,
   primitives, already-qualified ids). Unchanged, so no current reference breaks.

Only references **inside a term body** get the taxonomy-scoped treatment.
References elsewhere keep today's semantics.

### 4. Validation

- Each `uses` target must resolve to a **known taxonomy** in scope. Unknown name,
  or a name that resolves to a non-taxonomy, → a diagnostic (mirrors the model's
  `model.binding-undefined`).
- The cross-`uses` ambiguity diagnostic from Resolution Order step 2.

### 5. Surface area

- **Parser** (`parseTaxonomy`, `src/parse/parser.ts`): after the `represents`
  list and before `{`, optionally consume `uses <id>(, <id>)*`. Mirror
  `parseModel`'s `uses` loop.
- **AST** (`src/parse/ast.ts`): `TaxonomyDecl.uses: string[]` plus
  `usesSpans?: SourceSpan[]`, parallel to `ModelDecl.libraries` /
  `librarySpans`.
- **Loader** (`src/parse/loader.ts`): reference collection for a term's value refs
  (`collectValueRefs` / `collectNames`) must carry the enclosing taxonomy name and
  its `uses` list, and resolve a bare `N` by trying `X.N`, then each `Y.N`, before
  the existing bare check. Record the chosen qualified id so downstream edges point
  at the real term node. Emit the ambiguity diagnostic when >1 used taxonomy
  matches.
- **Validator** (`src/validate/validate.ts`): `uses`-target existence + kind check.
- **Formatter** (`src/…/format`): emit `uses <a>, <b>` on the taxonomy header;
  covered by the existing `format(parse(x)) == x` round-trip corpus.

### 6. Migration impact

`microsoft.todl` compiles as written: sibling `azure`/`m365`/`parent` auto-resolve
(step 1); `platform-api`/`conversational-interface` resolve through `uses categories`
(step 2). No reference in the file is rewritten. This turns the auto-migrated
libraries from "crash-masked / 518 errors" into clean compiles.

## Non-goals

- **Global implicit bare resolution** (any bare name against all loaded terms):
  rejected — reintroduces the cross-taxonomy ambiguity qualified ids were designed
  to prevent.
- **Type-directed resolution** (a field typed `categories` implying its value
  resolves within `categories`): a plausible future convenience, deliberately out
  of scope to keep bare resolution one obvious mechanism (sibling + `uses`).

## Open sub-points (resolve during planning)

1. Exact diagnostic codes/severity: `taxonomy.uses-undefined` (error) and
   `taxonomy.ambiguous-bare-reference` (error) — confirm names.
2. Whether a sibling silently shadowing a `uses` term deserves an *info*-level
   note. Default: silent (most-local wins, like lexical scope).
3. Nested sub-terms: a bare ref inside a nested term resolves against the whole
   enclosing taxonomy's term set (qualified ids are taxonomy-flat), not just its
   immediate parent — confirm this matches the id scheme.
