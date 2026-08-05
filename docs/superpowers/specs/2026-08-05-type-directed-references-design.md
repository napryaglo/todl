# Type-Directed References Design

**Date:** 2026-08-05
**Status:** Approved (design) — proceed to implementation plan
**Component:** TODL (`@pragmatic-lab/todl`) — parser, loader, model/API, validation

## Goal

Make value realization **type-directed** — the loader decides whether an
assignment becomes a scalar attribute or a reference edge from the *declared
type of the field*, not from the value's surface syntax — and retire the `&`
reference sigil. One rule, applied identically in instances and taxonomy
terms.

## Motivation

Today, whether `x = foo` becomes an attribute or an edge depends on **where**
it is written and **how**, never on what `x` is typed as. Two divergent,
syntax-directed code paths disagree:

- **Instance body** — `applyValue` ([loader.ts:720-743](../../../src/parse/loader.ts)):
  `String`/`Boolean`/`Composite` → attribute; a bare `Name` → `addRelationship`
  (an edge); `&ref` → the same `addRelationship`. So *every* bare name becomes
  an edge regardless of the field's type — a `string`-typed field given a bare
  name wrongly becomes an edge, and `&` is already redundant here.
- **Taxonomy term** — `termAttrs` / `termRelationships`
  ([loader.ts:479-509](../../../src/parse/loader.ts)): the opposite bias — a
  bare `Name` → attribute; only `&ref` → edge.

Consequences: the same `x = foo` means an edge in a model instance but a string
in a taxonomy term; a concept-typed field value that never resolves is silently
kept (as a dangling edge or a string) instead of being reported; and authors
must remember `&` for the term case while it does nothing in the instance case.

The canonical case this enables (two components sharing one technology
instance) already *works* for instances by accident of the blunt "all bare
names are edges" rule:

```todl
model microsoft {
    component m365-copilot-chat {
        label = "M365 Copilot";
        category = conversational-interface;   // taxonomy selection -> edge to term
        implemented-by = m365-copilot;         // concept ref -> edge to the shared instance
    }
    component m365-admin-chat {
        label = "M365 Copilot for Admins";
        category = conversational-interface;
        implemented-by = m365-copilot;         // same node -> shared, two edges in
    }
}
```

Sharing is the natural default in a graph (two edges into one node); it only
works because the value is a real edge to a specific instance node, never a
copied string. The rule that makes it work is just wrong in its *reasoning* —
this design replaces that reasoning with the field's type.

## The Rule

At value-realization time the loader looks up the field's declared type in the
committed concept schema and places the value accordingly:

| Field's declared type | Value becomes | Example |
|---|---|---|
| primitive (`string`, `boolean`, `identifier`, …) | scalar **attribute** | `label = "M365 Copilot"` |
| **concept** | **reference edge** (`EdgeKind.Relationship`, `via` = field name), shared by default | `implemented-by = m365-copilot` |
| taxonomy / enum | **term/case selection edge** (unchanged from how instances already behave, and how `checkTaxonomyValue` already validates) | `category = conversational-interface` |

Wins:

- Instances and terms behave identically.
- A concept- or taxonomy-typed value that does not resolve becomes a real
  `reference.undefined` diagnostic (enforced referential integrity), instead of
  a silent dangling edge or a string.
- `&` disappears — the field's type now carries what the sigil used to.

## `:` vs `->` — two forms, both edges, composition deferred

The field form (`name : Concept [card]`) and the relationship form
(`relationship name -> Concept [card]`) both compile to edges. They remain
distinct **only in their schema bucket** — `HasField` / `MetaKind.Field`
versus `HasRelationship` / `MetaKind.Relationship` — which already exist, so the
declaration side barely moves.

The composition intent of `:` ("has-a / part-of") is *labeled but not
enforced* in v1:

- No single-owner invariant, no cascade delete/move.
- Concept-typed `:` fields are **shared references by default** — required by
  the two-components-share-one-technology case.

Exclusive-ownership semantics (single owner, lifecycle binding), most likely
expressed via **inverse multiplicity** (a part whose back-reference is
"exactly one owner" is composition; "many owners" is a shared reference), are
explicitly **out of scope** and deferred to a later spec. No `owned` / `shared`
modifier is introduced now.

## Grammar Changes

Retire the `&` reference sigil / `Ref` value kind. `&` currently appears in
two places, both of which lose it:

1. **Field-value references** — `x = &foo` becomes `x = foo`
   ([parser.ts:415-431](../../../src/parse/parser.ts), `ValueKind.Ref`).
2. **Relationship / connector endpoints** — `<concept> &from -> &to` and
   `application-connectors { &a --> &b }` become `<concept> from -> to` /
   `{ a --> b }` ([parser.ts:359-406](../../../src/parse/parser.ts),
   `parseRef`). Endpoints are always references, so a bare name is unambiguous
   there.

`ValueKind.Ref` is removed from the AST; `parseValue` no longer special-cases
`TokenKind.Amp`; `parseRef` parses a bare dotted path with no leading `Amp`.
The `Amp` token itself may be removed from the lexer once no grammar uses it
(confirm during implementation).

## Loader Changes

Both realization paths switch from branching on `ValueKind` to branching on the
field's declared type:

- **Instances** — `applyValue` consults `model.effectiveSchema(concept)` (or
  equivalent) to classify each assignment: primitive-typed → `setField`;
  concept- or taxonomy/enum-typed → `addRelationship`. A `String` literal into
  a concept-typed field is a type/value mismatch (see Validation).
- **Terms** — `termAttrs` / `termRelationships` merge into one type-directed
  classification with the same three-way rule.

**Ordering wrinkle (must be handled in the plan):** taxonomy terms are built in
Pass 1 (`defineTaxonomy`), but concept schemas are not committed until Pass 2a.
Type-directed term classification needs the schema, so term value-realization
must be **deferred** until after schemas commit — there is precedent in the
existing `deferredCompositions` machinery
([loader.ts:246](../../../src/parse/loader.ts)) — or the passes reorder so
concept members commit before taxonomy terms. The plan chooses and justifies
one.

## Model / API Changes

- `effectiveRelationships` already collects all `Relationship` edges keyed by
  `via` (the field/relationship name), so it **already surfaces** concept-typed
  `:` field edges — no change needed to read them.
- `effectiveFields` keeps returning only genuine primitive attributes. It will
  no longer contain concept-typed fields (they are edges now).
- **Breaking read-shape change:** any consumer that previously read a
  concept-typed field out of `effectiveFields` must move to
  `effectiveRelationships`. `schemaOf` / `effectiveSchema` are unaffected — a
  `:` concept field is still declared as a `Field` and reflected under
  `fields[]`; only its *instance realization* is an edge.

## Validation Changes

- **Type/value-kind mismatch:** a concept-typed field given a quoted `String`
  literal is an error (a reference is expected, not a literal). A primitive
  field given a bare name is a literal (lenient — the bare name is the string
  value), unless the primitive is `boolean`, which keeps its existing
  boolean-value check.
- **Referential integrity:** an unresolved concept-/taxonomy-typed value
  produces the existing `reference.undefined` diagnostic, now actually reached
  for these fields. Edges to unresolved ids are dropped at `Builder.commit` as
  today.
- **Instances only inside a `model`:** `InstanceOrphan`
  ([loader.ts:535-556](../../../src/parse/loader.ts)) becomes **error
  severity** and blocks load/publish. A concrete instance (`isClass = false`)
  declared anywhere but inside a `model` block is an error, non-negotiable.
  (Reported-and-blocking diagnostic, consistent with TODL's error model — not a
  thrown exception.)

## Migration & Downstream Impact

- **Corpus migration** (`src/migrate/rewriter.ts`): strip `&` from field values
  and relationship/connector endpoints, then re-validate. Bare names into
  concept-typed fields that were silently stored as strings before will
  legitimately surface as `reference.undefined` where the referent was never
  declared — these are genuine authoring gaps to fix, not migration bugs. The
  migration reports them.
- **Emitted shape:** `toJSON` output changes (more edges, fewer attrs) — a
  **breaking TODL version bump**. The `toMetaModule` JS-module emitter and
  downstream Plexus / Mural consumers that read the graph must update and
  republish. This is the same shape of hard cutover as the namespace-scoped and
  taxonomy-bare-resolution changes.

## Out of Scope (v1)

- Composition ownership / cascade semantics.
- Inverse-multiplicity-driven exclusivity.
- Any `owned` / `shared` field modifier.
- Numeric value kinds beyond the current string-coercion behavior.

## Open Questions / Risks

- **`Amp` token removal:** confirm no other grammar production consumes `&`
  before deleting the token from the lexer.
- **Deferral vs. reorder:** the term-classification ordering fix is the main
  implementation risk; both options must preserve the existing
  namespace-scoped and bare-term resolution behavior.
- **Downstream breakage surface:** the `effectiveFields` → `effectiveRelationships`
  move for concept-typed fields must be audited across Plexus / Mural before the
  version bump lands.
