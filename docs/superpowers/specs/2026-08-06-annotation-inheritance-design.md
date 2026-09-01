# Annotation Inheritance (OOP `extends`) — Design

**Date:** 2026-08-06
**Status:** Draft — awaiting review.
**Component:** TODL (`@pragmatic-tech-ai/todl`) language + meta-model + reflection. Consumers (Plexus presentation/toolbox/publish) inherit the new behavior on a version bump, no logic change.

---

## 1. Vision

Annotations are typed decorators — `annotation icon { path : string }` applied via `annotate icon { path = "…" }` to concepts, terms, classes, and packages. Today each annotation is standalone: no shared base, no relationship between a general decorator and a specialized one. This design gives annotations **OOP-style single inheritance** — `annotation <Name> : <Base>` (the `:` supertyping syntax concepts use, `concept service : component`) — so a sub-annotation inherits its base's params and, when applied, **is-a** its base for querying (substitutability).

Two decisions frame it (from brainstorming): **polymorphic queries** (an `@icon` application counts as a `@visual` when `icon extends visual`) and **no param redeclaration** (a sub-annotation may not re-declare an inherited param name).

## 2. Mental model

- **Annotations already carry typed params as fields.** The loader stages each annotation param via `addField(annotation, name, type, cardinality)` — the same `HasField` machinery concepts use. So the field-inheritance engine (`effectiveFields`, which walks `Extends` first-wins) applies to annotations verbatim **once an annotation has an `Extends` edge**.
- **`extends` reuses the concept mechanism.** Concepts get their supertype via `defineConcept(name, parent)` → an `Extends` edge → `supertypesOf` (Extends closure). Annotations get the identical wiring via `defineAnnotation(name, parent)`. No new edge kind, no new closure.
- **Inheritance is declaration-side (params) AND query-side (polymorphism).** Params: an annotation's *effective* params = own ∪ inherited. Polymorphism: an application is indexed under its own annotation name and every ancestor annotation name, so a consumer querying the base finds specialized applications.
- **No redeclaration.** Unlike concept fields (silent first-wins override), a sub-annotation re-declaring an inherited param name is a **validation error** — each param is declared exactly once across the chain.
- **Single inheritance**, like concepts (`extends <one base>`).

## 3. Architecture

```
 annotation visual { icon : string; label : string }
 annotation detailed : visual { badge : string }          ← Extends edge (detailed → visual)

 loader:      defineAnnotation("detailed", parent="visual")  → Extends edge
              addField("detailed", "badge", …)               → own param only
 params:      effectiveFields("detailed") = { icon, label (inherited), badge (own) }
 validate:    • base "visual" must be an Annotation      → else annotation.base-not-annotation
              • "badge" ∉ inherited names                → else annotation.param-redeclared
              • annotate detailed { … } must supply icon+label+badge — ALREADY works:
                the app validator already reads effectiveSchema(annotation)
 query:       projectAnnotations(X) where X has @detailed
              → { detailed: {…}, visual: {…} }   (indexed under self + ancestors)
```

## 4. Component A — grammar + AST (`src/parse/parser.ts`, `src/parse/ast.ts`)

- **Grammar:** `parseAnnotation` reads an optional `: <dottedPath>` between the name and the `{` — copying `parseConcept`'s `match(Colon)` extends handling (`extendsName`, `extendsSpan`).
- **AST:** `AnnotationDecl` gains `extends: string | null` and optional `extendsSpan?: SourceSpan`, mirroring `ConceptDecl`.

## 5. Component B — loader wiring (`src/parse/loader.ts`, `src/model/builder.ts`)

- **`Builder.defineAnnotation(id, parent?: NodeId | null)`** — mirror `defineConcept(id, parent)`: stage the `MetaKind.Annotation` node and, when `parent` is non-null, stage an `Extends` edge to it. (No synthetic `element` default — annotations without `extends` have no base, unlike concepts which default-parent to `element`.)
- **Loader pass 1:** `first.defineAnnotation(declaration.name, declaration.extends ?? null)`. The base reference resolves through the existing reference machinery (unresolved base → `reference.undefined`).
- Param staging (pass 2a `addField` per param) is unchanged.

## 6. Component C — validation (`src/validate/validate.ts`)

Two new checks; application validation already handles inheritance:

- **`annotation.base-not-annotation`** (new `DiagnosticCode`) — the base resolves to a node whose `typeOf` is not `MetaKind.Annotation` → error (an annotation may only extend an annotation). Concepts don't validate base-kind, but an annotation extending a concept mixes concept fields into params, so this guard is annotation-specific and worth it.
- **`annotation.param-redeclared`** (new `DiagnosticCode`) — a param name declared on the annotation that also appears among its inherited params (`supertypesOf(annotation)` fields) → error, naming the base that already declares it. (Concepts allow first-wins override; annotations disallow it — the chosen semantic.)
- **Application param validation already uses effective params.** `validateAnnotationApplication` already reads `model.effectiveSchema(node.typeOf)` — so the moment an annotation has an `Extends` edge, inherited required params are required and inherited params are accepted, **with no change**. (Verified in `validate.ts`.)
- **No extends-cycle check** — concepts don't validate extends cycles either, and `graph.closure` is documented cycle-safe (no infinite loop). Out of scope for consistency; a degenerate cyclic `extends` is simply not guarded, exactly as for concepts.

## 7. Component D — polymorphic reflection (`src/publish/reflect.ts`)

`projectAnnotations(model: TodlDocument, targetId)` becomes is-a aware:

- Build an **annotation-supertype map** from the doc: for each `Extends` edge whose `from` is an `Annotation`-typed node, record `from → to`; the ancestors of an annotation are its `Extends` closure.
- For each `Annotated` edge `targetId → appNode` (typeOf = the applied annotation name), index the application's params under the annotation name **and every ancestor annotation name**. A consumer reading `result[baseName]` finds a sub-annotation application.
- **Params surfaced = the full application param set** (a superset when viewed under a base name — harmless; consumers read the base-declared keys they know).
- **Edge case:** two different sub-annotations of the same base on one target collapse under that base key — **last-wins in edge order** (matches today's same-name last-wins), noted for consumers.

Because the map is derived from doc edges, `projectAnnotations` keeps its doc-based signature — Plexus consumers are unchanged.

## 8. Consumers (Plexus) — no logic change

`projectAnnotations` was relocated to TODL and repointed across Plexus (presentation-generator, presentation-scaffold, toolbox-projection, meta-model-entity-builder, publish `deriveClasses`). They call the now-polymorphic function, so a subtype-annotated concept/term/class transparently resolves its base annotations (e.g. an `@detailed-icon` shows up where presentation reads `icon`). The only Plexus change is the TODL version bump.

## 9. Testing

- **Parser:** `annotation x extends y { … }` yields `AnnotationDecl.extends === "y"`; no-extends yields `null`.
- **Loader/params:** `effectiveFields(sub)` = own ∪ inherited; an `Extends` edge exists sub → base.
- **Validation:** extends a concept → `annotation.base-not-annotation`; redeclare an inherited param → `annotation.param-redeclared`; `annotate sub { … }` missing an inherited required param → the existing required-param error now fires on the inherited param (proves effective-param validation works through inheritance).
- **Polymorphism:** `projectAnnotations` on a target with a sub-annotation application returns the params under both the sub name and each base name; a base-only query finds it; two sub-annotations of one base → last-wins under the base key.
- **Round-trip / regression:** existing annotation tests (application validation, `projectAnnotations` direct cases, meta-model corpus) stay green; a no-`extends` annotation behaves exactly as today.

## 10. Scope / non-goals

- **In:** `:` base on annotation declarations (single inheritance), param inheritance, the two new validation checks (`base-not-annotation`, `param-redeclared`), polymorphic `projectAnnotations`. (Effective-param application validation already exists — no work.)
- **Out (documented):**
  - **Multiple inheritance** for annotations (single only, like concepts).
  - **Param override / merge** — redeclaration is an error, not a first-wins override; there is no per-param merge.
  - **Emitting annotation declarations** — meta-models are authored `.todl`, not machine-emitted; the model emitter (`emitModelTodl`) emits instances only, so no emit change.
  - **Abstract / sealed annotations, defaulted params** — not in scope.
  - **Concept↔annotation cross-extends** — an annotation extends only an annotation (enforced).

## 11. Open questions / risks

- **Reflection cost.** Building the annotation-supertype map per `projectAnnotations` call is O(edges); presentation calls it per node. If profiling shows churn, the map is memoizable by document — deferred until it earns itself.
- **`param-redeclared` placement.** The check needs an annotation node's own params vs its inherited params; it belongs beside the existing annotation validation. Risk: an annotation with no base must not false-positive (empty inherited set → no collision). Covered by a no-`extends` regression test.
- **Version bump.** New TODL minor (`0.18.0`) ships the language addition; Plexus bumps in lockstep to gain polymorphism.
