# Model term-drop via `uses` — design

**Status:** Implemented (TODL). Published `@pragmatic-lab/todl@0.13.0`.

## Problem

A model instance could not reference taxonomy terms by bare name. Terms are
stored as flat `taxonomy.term` nodes (`microsoft-tech.microsoft-graph`), so a
bare `implemented-by = microsoft-graph` needs *term-drop* — dropping the
taxonomy prefix. Term-drop only ran for references inside a **taxonomy body**
(a scope carrying the enclosing taxonomy + its `uses` list). Model instances
were visited with **no scope**, so every bare term came back
`reference.undefined`. On the real corpus this was 206 errors across ~7
taxonomies.

The `uses` clause on a model was parsed and stored, but consumed only as an
opaque *namespace* binding by `validate.ts` (constructor-scope) and Plexus's
emitter. It did nothing for value resolution — decorative.

## Decision

A model's `uses <taxonomy, …>` becomes its **term-drop scope**, the model
analogue of a taxonomy body's `uses`. `: <metaModel>` stays the meta-model
**namespace**. Author enumerates the taxonomies a model draws terms from
(chosen over type-directed drop and bound-namespace-wide drop for being the
smallest, most explicit engine change).

## Mechanics

- **loader / references:** a `ModelDecl`'s instance value refs are visited with
  `scope = { taxonomy: "", uses: decl.libraries }` (empty sibling slot — a model
  has no enclosing taxonomy). The loader normalizes `decl.libraries` qualified→flat
  and requires each to resolve to a known taxonomy (else `taxonomy.uses-undefined`),
  mirroring the taxonomy-`uses` pass. A bare id defined by two used taxonomies is
  `taxonomy.ambiguous-bare-reference` (and its edge is dropped so commit doesn't
  dangle).
- **validate:** `uses` entries are taxonomies. The model's bound-vocabulary
  namespace set = `{metaModel} ∪ {namespaceOf(each used taxonomy)}`; constructors
  (concept + class/term) must come from a bound namespace. `metaModel` is still
  flagged `model.binding-undefined` when no module provides it.

## Emitter (Plexus)

`deriveBindings(bases, own, namespace)` now returns `{ metaModel, uses, imports }`:
`uses` = the taxonomies whose terms the model references (collected from the own
reference edges via `taxonomy.term` node ids); `imports` = the base namespaces to
`import`. Emission writes `import <ns>;` per base namespace and
`model <ns>-model : <metaModel> uses <tax, …>`.

## Migration

Breaking for models. Hand-authored models must `uses` every taxonomy they draw
terms from (concepts stay bound via `: metaModel`). Corpus example: the
architecture landscape needs
`uses microsoft-tech, actors, application-kinds, billing-models, categories,
connectors, container-roles, environments, ingresses, networks`.
