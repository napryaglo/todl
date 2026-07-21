# Multi-Representation Taxonomies & Libraries-as-Taxonomies

**Date:** 2026-07-20
**Status:** Approved (design decisions locked via user Q&A)
**Repo:** TODL engine + test_project libraries & model

## Problem

A TODL taxonomy currently `represents` exactly one concept, and its terms are
classes of that one concept (`taxonomy component-category : represents category`).
Technology libraries are a separate construct — a `technology-library <name> :
<meta-model>` wrapper holding `location …` and `technology …` records.

We want a library to *be* a taxonomy that curates classes across more than one
concept:

```
taxonomy Microsoft : represents location, technology
{
    location azure          { label = "Azure"; type = cloud | paas; }
    technology azure-openai { label = "Azure OpenAI"; available-in = [Microsoft.azure]; }
}
```

`azure` is a class of `location`; `azure-openai` a class of `technology`; both
are curated under the `Microsoft` taxonomy.

## Decisions (locked)

- **Term syntax — concept keyword leads.** Inside a taxonomy body,
  `<concept> <id> { … }` declares a term that is a class of `<concept>`.
  `<concept>` must be one of the represented concepts. The bare `term <id> { }`
  form stays valid **only** when the taxonomy represents exactly one concept
  (the single-concept alias, e.g. `component-category`).
- **Qualified term ids.** A term's node id is `Name.id` (`Microsoft.azure`,
  `Microsoft.copilot-agent`) — consistent with `component-category`. All
  references across libraries + model are rewritten to the qualified form.
- **Keep the keyword `represents`** (a comma-list of ≥1 concepts).
- **No meta-model binding** on library-taxonomies (implied by the concepts they
  represent, same as `component-category`).
- **Delete the empty `default` library** and every `import default;` (category
  icons already live on `component-category` terms).

## Grammar

```
taxonomy <Name> : represents <C1> (, <Cn>)* { <member>* }
<member> ::= description = "…" ;
           | term <id> { <term-body> }          // single-concept alias only
           | <concept> <id> { <term-body> }      // concept-led term (a class of <concept>)
<term-body> ::= ( <assignment> | <member-term> )*
```

Nested terms use the same two forms and nest within the same concept
(hierarchy via `Narrower`). Library terms use `parent = &…` fields for their
own domain relationships (e.g. `location m365 { parent = &Microsoft.azure; }`),
which is orthogonal to term nesting.

## Graph model

Per taxonomy `Name` representing `C1…Cn`:
- One `Name` node, Ontology tier, `typeOf = MetaKind.Taxonomy`.
- One `Represents` edge `Name → Ci` per represented concept.
- Each term: an **Instance-tier class node** (`class = true`), `typeOf =` the
  term's own concept, id `Name.<termId>`, `attrs.id = <termId>`, a `Contains`
  edge `Name → term`, and a `Narrower` edge from parent term to child term.

## Engine changes

**AST (`parse/ast.ts`)**
- `TaxonomyDecl.represents: string` → `represents: string[]`.
- `Term` gains `concept: string | null` (the leading concept keyword; `null`
  for the bare `term` alias).

**Parser (`parse/parser.ts`)**
- `parseTaxonomy`: after `: represents`, parse an identifier list
  (`ident (, ident)*`).
- Body loop distinguishes three member kinds by lookahead:
  - `term` keyword → `parseTerm(concept = null)`.
  - identifier followed by another identifier (`<concept> <id>`) →
    concept-led term.
  - identifier followed by `=` → a `description = "…"` member.
- `parseTerm` takes the term's concept (null or the leading keyword) and applies
  the same lookahead for nested terms.

**Builder (`model/builder.ts`)**
- `TermInput` gains `concept?: string`.
- `defineTaxonomy(name, represents: string[], terms)`: stage one `Represents`
  edge per concept; each term node typed by `term.concept ?? represents[0]`
  (the `?? represents[0]` covers the single-concept alias). `class = true`,
  qualified id, `Contains`, `Narrower` — unchanged otherwise.

**Loader (`parse/loader.ts`)**
- `toTerm` carries `concept: t.concept ?? undefined`.
- `defineTaxonomy(decl.name, decl.represents, …)` (list).
- `collectNames`: `referenced.add(c)` for every `c` in `declaration.represents`;
  qualified term ids added to `defined` (unchanged).
- A bare `term` under a multi-concept taxonomy (no concept, `represents.length >
  1`) → a load diagnostic `TaxonomyTermConceptAmbiguous`; the term is typed by
  `represents[0]` as a best effort so loading proceeds.

**Model (`model/model.ts`)**
- `represents(taxonomy): NodeId[]` — all `Represents` targets (was single/null).
- `representedBy` unchanged.

**Validator (`validate/validate.ts`)**
- `checkRepresents`: `represents(node).length === 0` →
  `TaxonomyNoRepresentedConcept`.
- New `checkTermConcepts`: for each `Contains` child (term) of a taxonomy, the
  term's `typeOf` must be in the taxonomy's represents set — else
  `TermConceptNotRepresented`.

**Emitter (`emit/js-module.ts`)**
- `represents:` becomes a JS array of the represented concept slugs. `bare()`
  and the flat `terms` map are unaffected (ids stay `Name.id`).

**Diagnostics (`diagnostics/diagnostic.ts`)**
- Add `TermConceptNotRepresented = "taxonomy.term-concept-not-represented"` and
  `TaxonomyTermConceptAmbiguous = "taxonomy.term-concept-ambiguous"`.

## Migration (test_project)

- `libraries/microsoft.todl`, `libraries/aws.todl`:
  `technology-library X : enterprise-architecture { … }` →
  `taxonomy X : represents location, technology { … }`. Inner `location …` /
  `technology …` records are unchanged in shape — they are now terms.
- **Qualify every location/technology reference** to `<Taxonomy>.<id>`:
  `available-in`, `parent` (location parent), model `in = &…`, `implemented-by`,
  `realised-by`, `custom-technologies`, and cross-library refs. `component-category.*`
  refs are already qualified and unchanged. Scripted from a term-id→taxonomy map
  built off the libraries.
- Delete `libraries/default.todl` and every `import default;`.
- The `technology-library` wrapper is retired: remove it from the loader's
  `WRAPPER_CONCEPTS`. (Terms now sit inside the taxonomy, which is a real node,
  not a transparent wrapper.)

## Testing (TDD)

- Parser: a two-concept taxonomy with `location …` and `technology …` terms
  parses; `represents` is a two-element list; each term carries its concept. The
  single-concept `term …` alias still parses.
- Builder/loader: terms are typed by their own concept, `class = true`,
  qualified ids; two `Represents` edges exist; `represents()` returns both.
- Validator: a term whose concept is not represented →
  `TermConceptNotRepresented`; a taxonomy with no represented concept →
  `TaxonomyNoRepresentedConcept`.
- Emit: `represents:` is an array.
- Conformance (targeted): concepts + `component-category` + migrated `Microsoft`
  / `AWS` taxonomies + model load with zero object/binding diagnostics and the
  qualified references resolve.

## Refinements during implementation

- **Lowercase taxonomy names.** TODL identifiers are lowercase-kebab; the lexer
  rejects capitals. So library taxonomies are `microsoft` / `aws` (matching the
  old `technology-library` names), qualified ids `microsoft.azure`, `aws.aws`.
- **Nested-block rule inside a term (user decision "throw and require a concept").**
  A nested `<concept> <id> { }` inside a term is: a **sub-term** (Narrower) when
  its concept equals the parent term's concept; a **composition record** — a
  class-level record bound to the parent's field (like `component.slots`) — when
  its concept is a *different* represented concept; and a **load error**
  (`TermConceptNotRepresented`) when its concept is not represented at all. This
  is what makes `technology { billing … }` legal only under
  `represents … , billing`.
- **Terms carry relationships + composition.** Real library terms are richer than
  value-taxonomy terms: scalar assignments become attrs, `&ref`/list assignments
  become domain relationship edges (`location.parent`, `technology.available-in`),
  and different-concept nested blocks become bound composition records applied in
  pass 2b. Value taxonomies (`component-category`) are unaffected (scalar-only).

## Risks

- **Reference churn.** Qualifying every location/technology reference is broad
  and mechanical; a missed reference becomes an unresolved placeholder (no hard
  error, but a dangling ref). The conformance check must diff resolved-ref counts
  before/after.
- **`represents()` signature change** ripples to three callers (emit, validate,
  one test) — all updated in the same phase.
- Whole-project conformance stays blocked on the separate enum→taxonomy
  migration; this change is verified on its own slice.
```
