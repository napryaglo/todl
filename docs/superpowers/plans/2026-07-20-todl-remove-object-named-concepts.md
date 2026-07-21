# Remove `object` from TODL — Implementation Plan

> **For agentic workers:** executing-plans, TDD, checkbox steps. Held commits
> until "build and promote".

**Goal:** Delete the anonymous `object` construct from TODL (field-type and
value-literal), replacing it with named concepts and named nested records that
bind to typed fields.

**Architecture:** Grammar/AST/loader/emit drop `object`; the loader binds a
nested record of concept `T` to the parent field typed `T`; the EA meta-model
gains five concepts (`billing`, `slot`, `network-peer`, `category-binding`,
`meta`); instance data (libraries + model) migrates to nested records.

**Tech Stack:** TS ESM strict; tests `npx tsx --conditions=development --test "src/**/*.test.ts"` from `TODL/`.

## Global Constraints

- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; messages end
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. **HOLD all commits**
  until explicit "build and promote".
- Every test file in a `tests/` subfolder next to its source.
- Real TS enums, no string-literal unions.
- Working on `main`.

---

### Phase 1 — Loader: bind nested records to typed fields (TDD)

**Files:** Modify `src/parse/loader.ts`; Test `src/parse/tests/loader.test.ts`.

**Interfaces produced:** `applyInstance(builder, decl, parent, parentConcept, asserted)`;
loader pass 2 split into 2a (concept members) + 2b (instances). A load diagnostic
`DiagnosticCode.AmbiguousFieldBinding` when a parent concept has ≥2 fields of the
child's concept type.

- [ ] Add `AmbiguousFieldBinding = "instance.ambiguous-field-binding"` to `DiagnosticCode` (`src/diagnostics/diagnostic.ts`).
- [ ] Test: nested record of concept `T` inside a parent declaring `f : T[]` produces a `Relationship` edge named `f` to the child (assert via `model.related(parent, Relationship, Out, "f")`).
- [ ] Test: nested record with no matching parent field produces only `Contains` (no relationship).
- [ ] Test: parent with two fields typed `T` → one `AmbiguousFieldBinding` diagnostic, falls back to `Contains`.
- [ ] Implement: split pass 2; thread `parentConcept`; in `applyInstance`, resolve the binding field (`fieldsOf(parentConcept)` where `type === decl.concept`), add field-named relationship or diagnostic.
- [ ] Run the three tests → pass. Run full suite → no new reds beyond the 3 known conformance fails.

### Phase 2 — New concepts + field rewrites (schema)

**Files:** Create `concepts/{billing,slot,network-peer,category-binding,meta}.todl`;
Modify `concepts/{technology,network,component,model}.todl`, `meta-model.todl`.

- [ ] Create the five concept files (fields per spec table; each gets `id : identifier;` where it needs a record id).
- [ ] Rewrite the five `object { … }` fields to name the concepts.
- [ ] Move/reword the inline-`object` prose invariants onto the new concepts.
- [ ] Add the five to `top-level-concepts` (alphabetical).
- [ ] Targeted load check: concepts dir loads with 0 parse/load diagnostics.

### Phase 3 — Remove `object` from the grammar (TDD negatives)

**Files:** Modify `src/parse/parser.ts`, `src/parse/ast.ts`, `src/parse/loader.ts`;
Modify `src/parse/tests/parser.test.ts`.

- [ ] Replace `parser.test.ts` "parses an object-typed field" with: `object { … }` field type → diagnostic; `{ … }` value → diagnostic. Run → fail (still parses).
- [ ] `parseFieldType`: delete the `object` branch (field type is always `expectIdentifier()`).
- [ ] `parseValue`: delete the `LBrace` branch.
- [ ] `ast.ts`: remove `ValueKind.Object`, `ObjectValue`, its union arm.
- [ ] `loader.ts`: remove the `ValueKind.Object` cases (`collectValueRefs`, `applyValue`), delete `singularize` + `HoistCounter` + `counter` threading.
- [ ] Run negatives → pass. Run full suite → engine tests green.

### Phase 4 — Migrate instance data to nested records

**Files:** Modify `libraries/microsoft.todl`, `libraries/aws.todl`,
`models/ai-enabled-composable-landscape.todl`.

- [ ] Script the `billing = { … };` → `billing <tech>-billing { … }` conversion across the two libraries.
- [ ] Convert `model` `meta`, `peers`, `slots`, `billing`, `categories` literals to nested records (ids per spec conventions).
- [ ] Targeted load check on libraries + model: 0 parse/load diagnostics.

### Phase 5 — Conformance / validation gate

- [ ] Targeted validate: `billing`/`slot`/`network-peer`/`category-binding`/`meta` records resolve and their parent fields count them; `model.meta` (One) satisfied.
- [ ] Run full suite; document that whole-project conformance remains blocked on the separate unfinished enum→taxonomy migration (not this change).
- [ ] Summarize; hold commits.
