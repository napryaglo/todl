# TODL Class & Taxonomy Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the `class` / `instanceof` primitive and reframe taxonomies as
first-class entities that `represents` a concept and curate classes of it, per
`docs/superpowers/specs/2026-07-20-todl-class-taxonomy-model-design.md`.

**Architecture:** One `class` primitive = an Instance-tier node marked `class`,
typed by a concept. Reached via `InstanceOf` (identity) or classifying
`Relationship` edges (dimensions). A taxonomy is an Ontology node
(`typeOf = Taxonomy`) with a `Represents` edge to its concept; its terms are
class nodes typed by that concept.

**Tech Stack:** TypeScript ESM; `tsx --conditions=development --test "src/**/*.test.ts"`.

## Global Constraints

- Real TS enums, never string-literal unions.
- Every test file in a `tests/` subfolder beside its source.
- `class` marker = boolean node attr `class = true`; it is NOT a `MetaKind`.
- One level of instantiation only.
- A taxonomy represents exactly one concept (mandatory).
- Commits are **held** until the user says "build and promote" — do the work on a
  branch, stage per task, but do not `git commit`/push until instructed.

## File Structure (touched)

- `src/model/graph.ts` — `EdgeKind` gains `InstanceOf`, `Represents`.
- `src/model/builder.ts` — `assertInstance(…, {asClass})`, `addInstanceOf`,
  reshaped `defineTaxonomy(name, represents, terms)`, `TermInput` gains `attrs`.
- `src/model/model.ts` — queries: `isClass`, `classOf`, `instancesOfClass`,
  `represents`, `representedBy`, `termsOf`, `effectiveFields`,
  `effectiveRelationships`.
- `src/parse/ast.ts` — `TaxonomyDecl.represents`; `Term.assignments`;
  `InstanceDecl.isClass` + `.instanceOf`.
- `src/parse/parser.ts` — `class`/`instanceof` syntax; `: represents`; `term`
  keyword with general assignments.
- `src/parse/loader.ts` — wire the above into the builder.
- `src/diagnostics/diagnostic.ts` — new `DiagnosticCode`s.
- `src/validate/validate.ts` — partial-class exemption, effective completeness,
  no-contradiction, binding sanity, represents lint, value-resolves.
- `src/emit/js-module.ts` — reshaped taxonomy emission.
- `test_migration/test_project/**` — migration (separate repo, not committed).

**Preflight:** create branch `class-taxonomy-model` off `main` before Task 1.
Read `src/diagnostics/diagnostic.ts` for the current `DiagnosticCode` enum.

---

## Phase 1 — Graph + Builder primitives

### Task 1: `InstanceOf` + `Represents` edges

**Files:** Modify `src/model/graph.ts`; Test `src/model/tests/graph.test.ts` (extend).

- [ ] Add to `EdgeKind` (after `Narrower`): `InstanceOf, // leaf -> class` and
  `Represents, // taxonomy -> represented concept`.
- [ ] Test: build a graph with an `InstanceOf` and a `Represents` edge; assert
  `related(leaf, EdgeKind.InstanceOf, Direction.Out)` and
  `related(concept, EdgeKind.Represents, Direction.In)` return the endpoints.
- [ ] Run tests; commit-stage.

### Task 2: Builder — classes, `instanceof`, reshaped taxonomy

**Files:** Modify `src/model/builder.ts`; Test `src/model/tests/builder.test.ts`.

- [ ] `assertInstance(typeOf, id, asClass = false)` — when `asClass`, also stage
  attr `class = true` on the node.
- [ ] `addInstanceOf(leaf, cls)` — stage `EdgeKind.InstanceOf`, `via: null`,
  `from: leaf`, `to: cls`.
- [ ] `TermInput` gains `attrs?: ReadonlyMap<string, Scalar>` (the term's fixed
  field values); keep `children`.
- [ ] Reshape `defineTaxonomy(name, represents, terms)`:
  - stage taxonomy node `{ id: name, tier: Ontology, typeOf: MetaKind.Taxonomy }`;
  - stage `Represents` edge `name -> represents`;
  - per term (recursive), stage an **Instance-tier class node**
    `{ id: `${name}.${term.id}`, tier: Instance, typeOf: represents, attrs: {class:true, id:term.id, …term.attrs} }`;
  - stage `Contains` edge `name -> term` (membership) and, for nested terms,
    `Narrower` parent -> child.
- [ ] Tests: a taxonomy `component-category : represents category` with two terms
  produces class nodes typed `category`, marked `class`, with a `Represents` edge
  and `Contains` membership; nested terms get `Narrower`.
- [ ] Run tests; commit-stage.

---

## Phase 2 — AST + Parser

### Task 3: AST shape

**Files:** Modify `src/parse/ast.ts`; no standalone test (covered by parser tests).

- [ ] `TaxonomyDecl` gains `represents: string`.
- [ ] Replace `Term.label`/`Term.description` with `assignments: AssignmentNode[]`
  (terms are class bodies now); keep `id`, `children`, `span`.
- [ ] `InstanceDecl` gains `isClass: boolean` and `instanceOf: string | null`.

### Task 4: Parser — `taxonomy : represents` + `term` bodies

**Files:** Modify `src/parse/parser.ts`; Test `src/parse/tests/taxonomy-parse.test.ts`.

- [ ] `parseTaxonomy`: after the name, require `: represents <concept>` →
  `this.expect(Colon); this.expectKeyword("represents"); const represents = this.expectIdentifier();`
- [ ] Replace `| id { label/description }` term parsing with a `term` keyword form:
  `term <id> { <assignments>; <nested term>* }`. A term body loops: on
  `checkKeyword("term")` recurse into a child; else parse a `name = value;`
  assignment via `parseValue()` (reuse the instance-assignment shape).
- [ ] Test: `taxonomy component-category : represents category { term conversational-interface { icon = "…"; } }`
  parses to a `TaxonomyDecl` with `represents === "category"` and one term whose
  `assignments` carries `icon`.
- [ ] Run tests; commit-stage.

### Task 5: Parser — `class` + `instanceof`

**Files:** Modify `src/parse/parser.ts`; Test `src/parse/tests/parser.test.ts`.

- [ ] `parseDeclaration`: on `checkKeyword("class")` → advance, then
  `parseInstanceFrom(concept, start, {isClass:true})` where `concept` is the next
  identifier (`class component teams-chat { … }`).
- [ ] `parseInstanceFrom` signature gains an options object; after `expectRecordId`
  handle an optional `instanceof <class>`:
  `const instanceOf = this.checkKeyword("instanceof") ? (this.advance(), this.expectIdentifier()) : null;`
- [ ] Every `InstanceDecl` literal in the parser sets `isClass` and `instanceOf`
  (default `false`/`null`, including edge/connector records).
- [ ] Tests: `class component teams-chat { … }` → `isClass === true`;
  `component chat-hq instanceof teams-chat { … }` → `instanceOf === "teams-chat"`.
- [ ] Run tests; commit-stage.

---

## Phase 3 — Loader

### Task 6: Loader wiring

**Files:** Modify `src/parse/loader.ts`; Test `src/parse/tests/taxonomy-load.test.ts` + `class-load.test.ts` (new).

- [ ] `DeclKind.Taxonomy` build: call
  `defineTaxonomy(decl.name, decl.represents, decl.terms.map(toTerm))` where
  `toTerm` maps `assignments` → an attrs `Map` (string values only, mirroring
  `applyValue`'s string case) plus recursive `children`.
- [ ] `collectNames`: register `decl.represents` as referenced; keep qualified
  term ids (`name.term`) defined (recursive).
- [ ] `applyInstance`: when `decl.isClass`, pass `asClass = true` to
  `assertInstance`; when `decl.instanceOf !== null`, `builder.addInstanceOf(decl.id, decl.instanceOf)`
  and register it referenced in `collectInstanceNames`.
- [ ] `recordSpans`: taxonomy term spans keyed by qualified id (already recursive);
  no change to represents.
- [ ] Tests: load a two-file model (taxonomy + a class + a leaf); assert
  `model.resolve("component-category.conversational-interface")?.typeOf === "category"`
  and marked class; `classOf` of the leaf resolves to its class.
- [ ] Run tests; commit-stage.

---

## Phase 4 — Repository queries

### Task 7: class + taxonomy queries

**Files:** Modify `src/model/model.ts`; Test `src/model/tests/class-queries.test.ts` + `taxonomy-queries.test.ts` (update).

- [ ] `isClass(id)` → `this.resolve(id)?.attrs.get("class") === true`.
- [ ] `classOf(leaf)` → `this.related(leaf, EdgeKind.InstanceOf, Direction.Out)[0] ?? null`.
- [ ] `instancesOfClass(cls)` → `this.related(cls, EdgeKind.InstanceOf, Direction.In)`.
- [ ] `represents(tax)` → `this.related(tax, EdgeKind.Represents, Direction.Out)[0] ?? null`.
- [ ] `representedBy(concept)` → `this.related(concept, EdgeKind.Represents, Direction.In)`.
- [ ] `termsOf(tax)` → `this.related(tax, EdgeKind.Contains, Direction.Out)`.
- [ ] `effectiveFields(leaf)` / `effectiveRelationships(leaf)` — merge the leaf's
  own attrs/edges with its class's (via `classOf`); class-fixed values win, leaf
  adds fills. Return the merged view (used by validation + reactive later).
- [ ] Update `taxonomy-queries.test.ts` for the new tier/typeOf of terms.
- [ ] Tests for each query; run; commit-stage.

---

## Phase 5 — Validation

### Task 8: diagnostic codes + partial-class exemption

**Files:** Modify `src/diagnostics/diagnostic.ts`, `src/validate/validate.ts`;
Test `src/validate/tests/class-validate.test.ts` (new).

- [ ] Add `DiagnosticCode`s: `ClassOverride`, `BindingInvalid`,
  `TaxonomyNoRepresentedConcept`, `TaxonomyValueUnresolved`.
- [ ] In `validate`, when a node is a class (`isClass`), **skip completeness**
  (`RequiredMissing` / `EmptyNotAllowed`) — a class/term is a partial definition —
  but still run target-type and value type checks on the values it sets.
- [ ] For a **leaf** (`classOf !== null`), count fields/relationships over the
  **effective** view (own + inherited) so inherited class values satisfy required
  cardinality.
- [ ] Tests: a class omitting a required field → no `RequiredMissing`; a leaf whose
  class supplies the required field → no diagnostic; a leaf missing a still-unset
  required field → `RequiredMissing`.
- [ ] Run; commit-stage.

### Task 9: no-contradiction + binding sanity

**Files:** Modify `src/validate/validate.ts`; Test `src/validate/tests/class-validate.test.ts`.

- [ ] No-contradiction: for a leaf, any field/single-valued relationship it sets
  that differs from the class's fixed value → `ClassOverride` error (same value =
  allowed).
- [ ] Binding sanity: `instanceOf` target must exist, be `isClass`, and share the
  leaf's `typeOf` (concept) → else `BindingInvalid`.
- [ ] Tests for each; run; commit-stage.

### Task 10: taxonomy represents-lint + value-resolves

**Files:** Modify `src/validate/validate.ts`; Test `src/validate/tests/taxonomy-validate.test.ts` (new).

- [ ] Represents lint: every `typeOf = Taxonomy` node with no `Represents` edge →
  `TaxonomyNoRepresentedConcept`.
- [ ] Value-resolves: a value on a taxonomy-typed field must be a term of that
  taxonomy (`termsOf`); else `TaxonomyValueUnresolved`. (Field type names the
  taxonomy; resolve via schema.)
- [ ] Tests; run; commit-stage.

---

## Phase 6 — Emit

### Task 11: js-module taxonomy reshape + json parity

**Files:** Modify `src/emit/js-module.ts`; Test `src/emit/tests/js-module.test.ts`
(update), `src/emit/tests/taxonomy-json.test.ts` (update).

- [ ] Reshape `emitTaxonomy`: emit the represented concept + the class-terms table
  (id, own attrs, parent/children from `Narrower`). Drop the SP-Tax1 term-typing
  assumptions (terms are now Instance-tier, typed by the concept).
- [ ] `emitConcept` unchanged; registry `taxonomies` block keyed as before.
- [ ] JSON: add a test asserting `InstanceOf` / `Represents` / `class` attr round-trip
  through `toJSON`/`fromJSON` (no code change to `json.ts`).
- [ ] Run; commit-stage.

---

## Phase 7 — Migration + conformance

### Task 12: migrate `test_project`

**Files:** `test_migration/test_project/meta-models/enterprise-architecture/**`,
`libraries/**` (separate repo — edit, do not commit).

- [ ] Add `concept billing { label : string; description : string; }`.
- [ ] Keep `concept category`; delete the standalone `category <value> { icon }`
  instances, folding each icon onto the matching `component-category` term.
- [ ] Rewrite the 17 `enums/*.todl` taxonomies to
  `taxonomy X : represents <concept> { term <id> { <fields> } … }`, choosing the
  represented concept per taxonomy (`component-category → category`,
  `billing-model → billing`, …); move `label`/`description`/`icon` onto terms.
- [ ] `technology.applicable-to` / `billing.*` references switch to qualified term
  ids where the loader requires it.

### Task 13: conformance re-baseline

**Files:** `src/migrate/tests/taxonomy-conformance.test.ts` (update).

- [ ] Load the migrated `test_project`; capture the new diagnostic set (the
  SP-Tax1 81-cardinality baseline no longer holds).
- [ ] Assert the new expected count/shape; document any intentional residual
  diagnostics.
- [ ] Full suite green; `tsc` clean; commit-stage.

---

## Completion

After all tasks: full test suite green, `tsc` clean, then **stop and report** —
hold the commit until the user says "build and promote" (per Global Constraints).
Do not merge to `main` or publish; the Verdaccio bump is the user's call.
