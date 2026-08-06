# TODL Taxonomy Kind — Design (SP-Tax1)

**Status:** ⬜ Unfinished — superseded/reframed by the 2026-07-20 class & taxonomy model (the enum→taxonomy meta-kind was unpublished and replaced)

**Goal:** Replace TODL's `enum` meta-kind with a first-class `taxonomy` meta-kind — a
named tree of terms — with behavior-preserving migration of all existing enums to
flat (depth-1) taxonomies.

**Architecture:** A taxonomy is an Ontology-tier node (`typeOf = "taxonomy"`) whose
terms are Ontology-tier nodes typed by the taxonomy, linked parent→child by a new
`Narrower` edge. Terms reuse the exact node shape enum cases have today
(taxonomy-qualified ids, `label`/`description` attrs), so the runtime delta
is one `MetaKind` value, one `EdgeKind` value, four `Repository` query methods, and a
recursive parser/loader path. Hierarchy queries reuse the existing `closure()`
machinery that already backs concept `Extends`.

**Tech stack:** TypeScript (strict ESM), `@pragmatic-lab/todl`; tests via
`tsx --conditions=development --test "src/**/*.test.ts"`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises
  (`src/model/tests/…`), never beside the source.
- Real TS enums, never string-literal unions (`MetaKind`/`EdgeKind` stay enums).
- Behavior-preserving: after migration, `check(test_project)` must yield the
  identical diagnostic set and resolutions it does today (the conformance gate).

## Scope

**In (SP-Tax1):** the `taxonomy` meta-kind, its syntax, loader, validation, emit, the
mechanical migration of the 17 EA enums to flat taxonomies, removal of the `enum`
kind, and a conformance gate proving zero behavior change.

**Out (SP-Tax2, follow-up):** authoring real hierarchies (e.g. `component-category`'s
six-role tree), branch-targeting use (`technology.applicable-to` = a whole branch),
and any UI/consumer work. The downstream "architecture-definition compiler" (SP1/SP2,
parked) consumes whatever the meta-model becomes; it is unaffected structurally.

## §1 — Authoring syntax

A taxonomy declaration mirrors today's enum, with `terms` replacing `values`:

```
taxonomy component-category {
    description = """The archetype every component instantiates.""";
    terms {
        | web-portal { label = "Web Portal"; description = "…"; }
        | conversational-interface { label = "Conversational Interface"; aliases = [ai-chat]; }
    }
}
```

- **Flat parity:** each of the 17 enums migrates by keyword swap `enum`→`taxonomy`,
  `values`→`terms`. Term bodies keep `label`/`description`; instance values keep
  flag-combos (`cloud | paas`). A migrated flat taxonomy is behaviorally identical to
  the enum it replaced. (Note: `aliases = [...]` is parsed-and-dropped today — no
  resolver reads it — so it *stays* dropped under parity; alias support is a separate
  future feature, out of scope here.)
- **Nesting (new; authored in SP-Tax2):** a term body may contain child `| term { … }`
  rows in addition to attributes. The leading `|` distinguishes a child term from a
  `key = value;` attribute — the same one-token lookahead used today, applied at every
  depth.
- **Rules:** single parent per term (strict tree); a term carries attributes *and*
  zero-or-more child terms; arbitrary depth; term ids stay taxonomy-qualified
  (`component-category.api-service`).

## §2 — Meta-kind and tower placement

- Add `MetaKind.Taxonomy = "taxonomy"`; remove `MetaKind.Enum`. A taxonomy node is
  Ontology-tier, `typeOf = "taxonomy"` — the slot `enum` occupied.
- Each term is an Ontology-tier node typed by its taxonomy (`typeOf = component-category`),
  id taxonomy-qualified — identical to how enum cases are staged today.
- Add `EdgeKind.Narrower`, pointing **broader → narrower** (parent term → child term),
  mirroring how `Extends` backs concept hierarchy.
- Four new `Repository` queries (thin wrappers over `related`/`closure`):

  | Query | Implementation |
  |---|---|
  | `narrowerOf(term)` — direct children | `related(term, Narrower, Out)` |
  | `broaderOf(term)` — direct parent | `related(term, Narrower, In)` |
  | `descendantsOf(term)` — whole branch | `closure(term, Narrower, Out, …)` |
  | `ancestorsOf(term)` — path to root | `closure(term, Narrower, In, …)` |

  A flat (migrated-enum) taxonomy has no `Narrower` edges, so every term is a root and
  these return empty — the behavioral parity.
- Field typing is unchanged at the schema level (`type = <taxonomy-id>`). "Any level"
  is a validation rule (§4), not a schema change.

## §3 — Loader

- **AST:** rename `EnumDecl` → `TaxonomyDecl`; terms become recursive:
  ```ts
  interface TaxonomyDecl { kind: DeclKind.Taxonomy; name: string; description: string; terms: Term[]; span: SourceSpan }
  interface Term { id: string; attrs: Assignment[]; children: Term[]; span: SourceSpan }
  ```
- **Parser:** `parseEnum` → `parseTaxonomy` (keyword `taxonomy`, block `terms`);
  `parseEnumValues` → `parseTerms`, made recursive. Base case (no `|` children) parses
  a flat taxonomy exactly as an enum parses today.
- **Builder:** `defineEnum` → `defineTaxonomy(name, terms)`: stage the taxonomy node
  (`Tier.Ontology`, `MetaKind.Taxonomy`); walk the tree depth-first staging each term
  (`Tier.Ontology`, `typeOf = name`, qualified id `name.termId`, attrs); stage a
  `Narrower` edge per parent→child pair (top-level terms are roots, no edge).
- **Loader:** the one dispatch site `EnumDecl → defineEnum` becomes
  `TaxonomyDecl → defineTaxonomy`. Per-term spans recorded by qualified id.
- **Unchanged:** instance-side value resolution (alias lookup, flag-combos) in the
  existing `applyValue` path — it resolves a term by id/alias regardless of depth.

## §4 — Validation

- **SP-Tax1 strict parity:** terms occupy the identical node shape enum cases have, so
  the enum-membership resolution simply retargets to taxonomy terms. No diagnostic is
  added or removed.
- **"Any level" needs no new guard:** every term (leaf or internal) has
  `typeOf = <taxonomy>`, so a value pointing at an internal branch term passes the same
  membership check a leaf does. No leaf-only restriction, no new diagnostic code.
- **Branch-targeting is a query, not validation:** expanding a branch term to its
  descendants (`descendantsOf()`) happens at use sites (SP-Tax2), not in `validate()`.

The only edit is retargeting the enum-membership resolution to read "taxonomy term."

## §5 — Emit

- **JSON (`emit/json.ts`) — free:** `toJSON`/`fromJSON` walk nodes/edges generically.
  Taxonomy nodes, term nodes, and `Narrower` edges round-trip once `Narrower` is added
  to `EdgeKind` (the `JsonEdge.kind` is already a stringified `EdgeKind` name). No
  emitter-specific code.
- **js-module (`emit/js-module.ts`) — retarget:** it references `MetaKind.Enum`, so:
  `instancesOf(Enum)` → `instancesOf(Taxonomy)`; `emitEnum` → `emitTaxonomy`; registry
  key `enums:` → `taxonomies:`. Emit each term with `parent` + `children` fields (empty
  for flat), forward-compatible with SP-Tax2. **Preserve `has()`** (flag-combo
  membership) verbatim. (Aliases are not emitted today — nothing to preserve there.)
  For SP-Tax1 (all flat) the output equals today's enum tables plus empty
  `parent`/`children`.

## §6 — Migration & conformance gate

- **Mechanical file migration:** the 17 enum declarations in
  `meta-models/enterprise-architecture/enums/*.todl` migrate by token swap
  `enum`→`taxonomy`, `values`→`terms`, introducing no nesting. Field references
  (`category : component-category`) are unchanged. The meta-model descriptor updates
  only if it names the `enum` kind.
- **Enum-kind removal:** delete `MetaKind.Enum`, `parseEnum`/`EnumDecl`, `defineEnum`,
  `emitEnum`, and references once migrated and green.
- **Conformance gate (the consistency guarantee):** a test asserting the migration
  changed nothing observable —
  - `check(test_project)` yields the identical 81 diagnostics (codes, paths, counts)
    and 0 on the meta-model;
  - `component-category.api-service` resolves; flag-combos (`cloud | paas`) resolve;
    `technology.applicable-to` validates;
  - the serialized graph differs only by `typeOf: "enum"→"taxonomy"` on those nodes
    (and gains `Narrower` edges — zero for flat).
- **New unit tests:** nested `terms` parse into term nodes + `Narrower` edges;
  `descendantsOf`/`ancestorsOf`/`narrowerOf`/`broaderOf` return correct sets; a mixed
  attrs-and-children term body parses unambiguously.

**Phasing (Approach A):** add the taxonomy kind alongside enum → migrate the 17 files →
remove enum → conformance passes. Tests stay green at every step.

## Testing

- Unit tests per touched module (`parse`, `model`, `validate`, `emit`) in `tests/`
  subfolders.
- The conformance gate as an integration test loading the migrated `test_project`.
- `tsc --noEmit` clean; full suite green.
