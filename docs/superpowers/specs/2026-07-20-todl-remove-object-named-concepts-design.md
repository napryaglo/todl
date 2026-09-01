# Remove `object` from TODL — Named Concepts & Nested Records

**Date:** 2026-07-20
**Status:** ✅ Finished
**Repo:** TODL (`@pragmatic-tech-ai/todl`) + test_project EA meta-model & instance data

## Problem

TODL has an anonymous structured-type construct, `object { … }`, used two ways:

1. **As a field type** in concepts — an inline anonymous struct:
   `billing : object { hosting : billing-model?; … }?;`
   Parsed by `parseFieldType` (`parser.ts`), stored as the flat string
   `"object { hosting: billing-model?, … }"`.
2. **As a value literal** in instance data — an anonymous inline record:
   `billing = { hosting = billing-model.azure-consumption; };`
   Parsed by `parseValue` (`ValueKind.Object`), and *hoisted* by the loader into
   a standalone record typed by a naive `singularize(fieldName)` guess
   (`peers`→`peer`, `categories`→`categorie`), linked to the parent by a
   field-named `Relationship` edge.

TODL's ontology is concepts, taxonomies, primitives, relationships. An anonymous
struct is none of these; the hoisted records are typed by names that are never
defined as concepts, so they are effectively untyped. **Decision: `object` must
not exist in TODL.** Every structured thing is a named concept; every structured
value is a named nested record.

## Decisions (locked)

- **Scope:** full language removal — drop `object` from the grammar (both the
  field-type branch and the `{ … }` value-literal branch), the AST, the loader,
  and the emitter. Add negative tests proving both now error.
- **`model.categories`:** keep per-model icon override — becomes a
  `category-binding` concept.
- **`technology.billing`:** becomes a `billing` concept (aligns with the
  `billing-model` taxonomy already added).
- **`model.meta`:** keep as a `meta` concept (not flattened).
- **Instance data:** no anonymous literals — every `{ … }` value becomes a
  named nested record.

## New concepts

Five new concept files under
`test_migration/test_project/meta-models/enterprise-architecture/concepts/`:

| Concept | Fields |
|---|---|
| `billing` | `hosting : billing-model?`, `per-call : billing-model?`, `per-seat : billing-model?`, `capacity : billing-model?` |
| `slot` | `id : identifier`, `label : string`, `environment : identifier`, `in-resource-group : identifier?`, `in-subnet : identifier?`, `public-ingress : ingress-kind[]` |
| `network-peer` | `network : identifier`, `via : connectivity-kind` |
| `category-binding` | `id : component-category`, `icon : string` |
| `meta` | `title : string`, `meta-model : identifier` |

Each carries an `id : identifier;` where it needs a record id (`slot`,
`category-binding` already listed; `billing`, `network-peer`, `meta` get an
`id : identifier;` so nested records can be named).

### Field rewrites

- `technology`: `billing : object { … }?;` → `billing : billing?;`
- `network`: `peers : object { … }[];` → `peers : network-peer[];`
- `component`: `slots : object { … }[];` → `slots : slot[];`
- `model`: `meta : object { … };` → `meta : meta;`
- `model`: `categories : object { … }[];` → `categories : category-binding[];`

`meta-model.todl` `top-level-concepts` gains: `billing`, `category-binding`,
`meta`, `network-peer`, `slot` (kept alphabetical).

The prose invariants that described the inline `object` sub-fields (e.g.
technology's "billing is a structured cost-dimension stack…") move onto the new
concept or are reworded to reference it. No behavioral invariant is lost.

## Language change: nested records bind to typed fields

**Core semantic.** Today a field's cardinality count =
`(scalar attr present ? 1 : 0) + (Relationship edges named field)`
(`validate.ts`). A plain nested record (`slot foo { … }`) creates only a
`Contains` edge, so it does **not** populate a typed field. The object-value
hoist created a field-named `Relationship`, which is why the current instance
data satisfies fields.

To make named nested records first-class (and drop the hoist), the loader binds
a nested record to its parent's matching field:

> When applying a nested record of concept `T` inside a parent whose concept
> declares a field typed `T`, add a `Relationship` edge named after that field
> (in addition to the structural `Contains` edge). If no such field exists, keep
> only `Contains` (unchanged behavior for containment-only records like
> `subscription`, `network`, `subnet`).

This makes `slot` records populate `slots`, `billing` populate `billing`, `meta`
populate `meta`, `network-peer` populate `peers`, `category-binding` populate
`categories` — exactly what the old hoist did, but with real types and real ids.

**Loader restructure.** Binding-by-type needs the field schema available when
instances are applied. Pass 2 currently interleaves "add concept members" and
"apply instances" by declaration order. Split it:

- **Pass 2a:** add every concept's fields + relationships + invariants.
- **Pass 2b:** apply every instance (schema now complete; `applyInstance` can
  look up `parentConcept`'s field whose `type === child.concept`).

`applyInstance` gains the parent's concept (already has `parent` id; also pass
`parentConcept`) so it can resolve the binding field via
`model.fieldsOf(parentConcept)`.

**Ambiguity rule.** If a parent concept declares two fields of the same concept
type, binding is ambiguous — emit a load diagnostic and fall back to `Contains`
only. (No EA concept hits this today; the rule is a guard.)

## Grammar & engine removals

- `parser.ts`
  - `parseFieldType`: delete the `object` branch → a field type is always
    `expectIdentifier()`. A stray `object` now surfaces as
    `expected ":" …`/`UnexpectedToken`.
  - `parseValue`: delete the `LBrace` branch (the `{ … }` object literal). A
    `{` in value position now errors `expected a value`.
- `ast.ts`: remove `ValueKind.Object`, `ObjectValue`, and its arm of the
  `ValueNode` union.
- `loader.ts`: remove the `ValueKind.Object` cases in `collectValueRefs` and
  `applyValue`; delete `singularize` and `HoistCounter` and the `counter`
  threading.
- `emit/js-module.ts`: no `object`-specific code — unaffected.
- `validate.ts`: no `object`-specific code — unaffected by removal, but its
  field-count logic already reads field-named `Relationship` edges, so
  binding-by-type populates counts with no validator change. (Confirm slot/meta
  cardinalities validate after migration.)

Out of scope: `migrate/rewriter.ts` (a legacy one-shot string converter, not the
live language). Its `list<object{…}>` lowering test may remain; it does not
affect the runtime grammar.

## Instance-data migration

Every `{ … }` value literal in libraries and models becomes a named nested
record. Record-id conventions:

- `slot`: reuse the existing `id =` value in the literal (`web`, `api`, …).
- `network-peer`: `<network>-<peer-network>` (e.g. `enterprise-vnet-on-prem-network`).
- `billing`: `<parent-tech-id>-billing`.
- `meta`: `<model-id>-meta`.
- `category-binding`: `<component-category>-binding`.

Transformation example (technology, `microsoft.todl`):

```
technology copilot-studio-agent {
    label = "Copilot Studio Agent";
    billing = { per-call = billing-model.copilot-credits; capacity = billing-model.copilot-credits; };
}
```
becomes
```
technology copilot-studio-agent {
    label = "Copilot Studio Agent";
    billing copilot-studio-agent-billing {
        per-call = billing-model.copilot-credits;
        capacity = billing-model.copilot-credits;
    }
}
```

`slots` / `peers` lists become one nested record per element. `meta` becomes one
nested `meta <model>-meta { … }` record.

Files: `libraries/microsoft.todl`, `libraries/aws.todl`,
`models/ai-enabled-composable-landscape.todl`. The billing conversions are
mechanical (scriptable); slots/peers/meta are fewer and done directly.

## Testing (TDD)

Engine unit tests (in `src/**/tests/`):

1. `parser.test.ts` — replace "parses an object-typed field" with two negatives:
   `object { … }` in a field type errors; `{ … }` in a value errors.
2. `loader.test.ts` — a nested record of concept `T` inside a parent with a
   field typed `T` produces a field-named relationship (count reflects it);
   a containment-only nested record (no matching field) produces only `Contains`.
3. `loader.test.ts` — ambiguous double-field-of-same-type emits a diagnostic and
   falls back to `Contains`.
4. `validate` — a component with `slot` nested records validates; a `model`
   with a `meta` nested record satisfies the `meta : meta` (One) field;
   omitting it yields `RequiredMissing`.

Conformance: the whole test_project loads and validates with zero diagnostics
after migration (the standing conformance gate).

## Risks

- **Newly-enforced fields.** Binding-by-type makes previously-decorative fields
  count real records. Any One/NonEmpty field whose records are actually missing
  in the instance data will now (correctly) error. Surface and fix during the
  conformance phase; do not relax cardinalities to paper over genuine gaps.
- **`meta` One cardinality** is the canonical case above — must bind or it fails.

## Task phasing (for the plan)

1. New concepts + field rewrites + `top-level-concepts` (schema only).
2. Loader: split pass 2, add binding-by-type + ambiguity diagnostic (TDD).
3. Grammar/AST/loader/emit removal of `object` (TDD, negative tests).
4. Instance-data migration (libraries, then model).
5. Conformance gate: whole project loads + validates clean.
