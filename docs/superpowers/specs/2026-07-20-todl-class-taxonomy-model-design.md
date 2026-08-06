# TODL Class & Taxonomy Model — Design Spec

**Date:** 2026-07-20
**Status:** ✅ Finished

**Goal:** Introduce a unified `class` / `instanceof` instantiation model, and
reframe taxonomies as first-class entities that *represent* a concept and curate
*classes* of it — replacing the SP-Tax1 Ontology-tier taxonomy terms (2026-07-19).

**Architecture:** One `class` primitive (an Instance-tier, partial, fixed-value
node typed by a concept), reached two ways: `instanceof` (identity) and
classifying relations (dimensions). A taxonomy is a first-class Ontology entity
that `represents` exactly one concept and curates a `Narrower` hierarchy of terms
(= classes of that concept). No tower tiers are added.

**Tech Stack:** TypeScript, `@pragmatic-lab/todl`; Node test runner; real TS enums.

**Scope:** TODL language + runtime only (program sub-project #1). The per-project
instance storage + Cypher query layer (#2) is captured in
`2026-07-20-todl-classes-and-instance-storage-design.md` and deferred.

**Breaking change.** This reframes SP-Tax1. The taxonomy kind is unpublished (no
Verdaccio consumers), so nothing downstream breaks; `test_project` migrates in the
same effort.

## Global Constraints

- Real TS enums, never string-literal unions.
- Every test file lives in a `tests/` subfolder beside its source.
- `class` is an Instance-tier *marker*, not a new `MetaKind`.
- Instantiation is **one level only** — a leaf (an `instanceof` target's instance)
  is not itself a class.
- A taxonomy represents **exactly one** concept (mandatory).

---

## Vocabulary

- **Concept** — the ontology brick. Ontology tier, `typeOf = Concept`. Declares
  entities and relations (schema: fields + relationships).
- **Class** — Instance-tier node, marked `class`, typed by a concept; a *partial*
  definition whose set values are *fixed*. `teams-chat` is a class of `component`.
- **Leaf** — Instance-tier node carrying an `InstanceOf` edge to a class; the
  concrete deployment. `chat-hq instanceof teams-chat`.
- **Taxonomy** — first-class Ontology entity, `typeOf = Taxonomy`. Represents one
  concept (`Represents` edge) and curates a `Narrower` hierarchy of terms.
- **Term** — a class that is a member of a taxonomy: Instance-tier, marked `class`,
  typed by the *represented concept*, taxonomy-qualified id
  (`technology-categories.web-portal`). `term` is the in-taxonomy spelling of
  `class`.

## Reflective tower encoding

| Tier | Nodes | `typeOf` |
|------|-------|----------|
| Meta | `Concept`, `Primitive`, `Field`, `Relationship`, `Taxonomy` | — |
| Ontology | concepts (`component`, `technology`, `category`, **`billing`**) | `Concept` |
| Ontology | taxonomies (`component-category`, `billing-model`, …) + `Represents` → concept | `Taxonomy` |
| Instance | classes / terms (`teams-chat`, `conversational-interface`, `m365-copilot-usl`), marked `class` | the concept |
| Instance | leaves (`chat-hq`) + `InstanceOf` → class | the concept |

- **New edges:** `InstanceOf` (leaf → class), `Represents` (taxonomy → concept).
- **Reused edges:** `Narrower` (term → child term), `Contains` (taxonomy → term
  for membership), `Relationship` (classifying edge holder → term, via field name),
  plus `Extends` / `HasField` / `HasRelationship`.

## Syntax

```
concept category { label : string; icon : string; }                 // brick — unchanged

class component teams-chat {                                         // open class of a concept
    realised-by = microsoft-teams;
    category    = conversational-interface;
}

component chat-hq instanceof teams-chat { in = hq; }                 // leaf

taxonomy technology-categories : represents category {              // taxonomy of classes-of-category
    term web-portal { label = "Web"; icon = "resources/web-portal.svg"; }
}

technology web-application {
    applicable-to = [technology-categories.web-portal];             // classify + implicit technology → category
}
```

- `class <concept> <id> { … }` — a class of `<concept>`.
- `<concept> <id> instanceof <class> { … }` — a leaf.
- `taxonomy <id> : represents <concept> { term <id> { … } … }` — terms nest for
  `Narrower` hierarchy.
- Keyword `: represents` (not `: extends`, which stays concept-inheritance).

## Semantics

### Effective definition — `instanceof` only

`effective(leaf)` = the class's fixed fields/relationships overlaid with the
leaf's own fill-ins. Class values are resolved on read by following `InstanceOf`,
never copied — leaf records stay small; a class edit doesn't rewrite deployments.

### Classification + implicit relation

A field typed by a taxonomy stores classifying `Relationship` edges (holder → term,
via the field name) **and** induces an implicit relation `holder → represented
concept` (derived, queryable). Term data (e.g. `icon`) is reached by *traversal*
to the term — **not** merged into the holder. This keeps multi-valued fields like
`applicable-to` unambiguous and matches the icon's existing lookup behaviour.

### Validation

1. **`instanceof` no-contradiction** — a leaf setting a class-fixed field or
   single-valued relationship to a *different* value is an error; same value is
   redundant, allowed.
2. **completeness-on-effective** — the merged class+leaf must satisfy the concept's
   schema; a class/term alone is exempt from completeness (partial), but each value
   it sets must type-check.
3. **binding sanity** — `instanceof X` requires X marked `class`, sharing the
   leaf's concept, and existing.
4. **taxonomy represents a concept** — mandatory; a taxonomy naming no concept is a
   lint (`taxonomy.no-represented-concept`).
5. **taxonomy-typed value resolves** — a value on a taxonomy-typed field must be a
   term of that taxonomy.

## Repository queries

- Class model: `isClass(id)`, `classOf(leaf)`, `instancesOfClass(class)`,
  `effectiveFields(leaf)`, `effectiveRelationships(leaf)`.
- Taxonomy: `represents(taxonomy)`, `representedBy(concept)`, `termsOf(taxonomy)`;
  `instancesOf(concept)` returns classes + leaves (filter via `isClass`).

## Emit / persistence

- `toJSON` / `fromJSON` — new edges (`InstanceOf`, `Represents`) and the `class`
  marker ride the generic node/edge serialization; format unchanged in shape.
- `js-module` — the SP-Tax1 taxonomy table is reshaped: a taxonomy projects its
  represented concept + its class-terms. Concept class emission unchanged.

## Migration (`test_migration/test_project`)

- Add `concept billing { label : string; description : string; }`.
- Keep `concept category`.
- Re-express the 17 EA taxonomies as `taxonomy X : represents <concept> { term … }`,
  each term a class of the represented concept, carrying the concept's fields.
- Fold the standalone `category` icon-binding instances into the
  `component-category` / `technology-categories` terms.
- Re-baseline the conformance test: the diagnostic set changes shape from the
  SP-Tax1 81-cardinality baseline; capture the new expected set.

## Impact on SP-Tax1 (what changes)

- Terms move Ontology → Instance tier; `typeOf` changes from the taxonomy name to
  the represented concept.
- Add `Represents` (taxonomy → concept) and `InstanceOf` (leaf → class) edges.
- Taxonomy `js-module` emission reshaped. `Narrower` hierarchy retained.

## Out of scope

- Sub-project #2 (per-project instance storage + Cypher query).
