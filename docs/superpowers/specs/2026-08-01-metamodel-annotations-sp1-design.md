# Meta-Model Annotations — SP1 (TODL language) Design

**Status:** design complete, pending user review
**Target package:** `@pragmatic-lab/todl` (0.4.0 → **0.5.0**, reserves new keywords)
**Date:** 2026-08-01

## 0. Context — the three sub-projects

The overall goal is a `.NET-attributes`-style mechanism for meta-model metadata:
typed, author-declared **annotations** that decorate concepts and the package,
so (a) the presentation compiler can produce better templates and (b) Plexus can
understand a package. It spans three subsystems and is decomposed into three
sequenced sub-projects, each its own spec → plan → build:

- **SP1 (this spec) — TODL language.** The `annotation` / `annotate` constructs,
  their reflective-graph representation, typed validation, and emit. Self-
  contained and testable in TODL alone; everything downstream consumes its
  `model.json` output.
- **SP2 — Plexus projection + package manifest.** Project a concept's annotations
  into a static, shared `Annotations` bag on `MetaModelEntity` / the per-concept
  type object (the `$Type` hop for canvas instances); emit a thin `manifest.json`
  projecting the package node's annotations for cheap Plexus consumption.
- **SP3 — Presentation hybrid + Mural.** The presentation generator bakes
  well-known annotations into per-concept templates AND emits a generic bindable
  template; any Mural converter needed (e.g. icon-path → geometry).

SP1 is the foundation and the only subject of this document.

## 1. Goal (SP1)

Add **annotations** to the TODL language: typed, author-declared metadata that
statically decorates a **concept** or the **package**. An annotation type is a
first-class declaration whose parameters are typed and compiler-validated; an
application attaches fixed parameter values to a target. Annotations are
**static, type-level** — they live on the ontology node and are never
materialized per instance. They compile into the reflective graph (Option 3), so
they emit into `model.json` with zero emitter changes and are queryable through
the existing `Repository` API.

## 2. Locked decisions

- **Closed / typed vocabulary.** Every annotation is a declared type with typed
  params; misuse (undefined annotation, unknown/missing/mistyped param) is a
  compile error.
- **Targets: concepts + package only** (not fields, relationships, or taxonomy
  terms). No per-annotation target restriction — `annotate` is structurally legal
  only inside a concept body or a `package { }` block.
- **Reflective-graph representation** (Option 3): annotation defs, applications,
  and links are graph nodes/edges in `model.json`.
- **Static / type-level semantics**: applications attach to the Ontology-tier
  concept (or the package node); nothing in the Instance tier references them.
- **Param types are scalar for v1**: string / number / boolean / enum /
  primitive-typed. Lists, references, and nested objects are a future extension
  (they would exceed the scalar `attrs` contract).
- **Single application per (target, annotation)** by default; a duplicate is an
  error. `AllowMultiple` is a future flag.

## 3. Surface syntax

```todl
namespace acme {
  // ── Annotation type declarations (typed params, like a concept's fields) ──
  annotation Icon     { path : string; }
  annotation Category { name : string; order : number?; }
  annotation Author   { name : string; email : string?; }
  annotation License  { spdx : string; }

  // ── Package-level applications ──
  package {
    annotate Author  { name = "Acme Corp"; email = "eng@acme.io"; }
    annotate License { spdx = "MIT"; }
  }

  // ── Concept-level applications (static — attached to the concept type) ──
  concept actor {
    annotate Icon     { path = "icons/actor.svg"; }
    annotate Category { name = "actors"; order = 1; }
    label : string;
  }
}
```

- `annotation <Name> { <param> : <type><card>; … }` — a new top-level declaration
  (sibling of `concept` / `primitive`). Params are typed fields (`?` optional).
- `annotate <Name> { <param> = <value>; … }` — an application, legal **only**
  inside a `concept` body or a `package { }` block.
- `package { <annotate>… }` — a new top-level block holding only applications.

`annotation`, `annotate`, and `package` become **reserved keywords.**

## 4. AST + parser

`DeclKind` gains `Annotation` and `Package`. New nodes (params reuse the existing
`FieldDecl`):

```ts
export interface AnnotationApplication {
  name: string;               // the annotation being applied
  assignments: AssignmentNode[]; // param = value pairs
  span: SourceSpan;
  nameSpan?: SourceSpan;
}

export interface AnnotationDecl {
  kind: DeclKind.Annotation;
  name: string;
  params: FieldDecl[];        // typed params, reuse FieldDecl
  span: SourceSpan;
  nameSpan?: SourceSpan;
}

export interface PackageDecl {
  kind: DeclKind.Package;
  annotations: AnnotationApplication[];
  span: SourceSpan;
}

// ConceptDecl gains:
//   annotations: AnnotationApplication[];

export type Declaration =
  | ConceptDecl | TaxonomyDecl | PrimitiveDecl | InstanceDecl | ModelDecl
  | AnnotationDecl | PackageDecl;
```

Parser:

- `parseDeclaration` dispatches `annotation` → `parseAnnotation` and `package` →
  `parsePackage`, before the generic-instance fallback (each is a reserved
  keyword).
- `parseAnnotation`: `annotation <Name> { <field>; … }` — a body of typed param
  fields, reusing the concept field parser. No relationships/invariants.
- `parsePackage`: `package { <annotate>… }` — a body of `annotate` applications.
- Inside `parseConcept`'s body loop, an `annotate` keyword parses an
  `AnnotationApplication` and appends it to the concept's `annotations` (peer to
  fields / relationships / invariants).
- `parseAnnotationApplication`: `annotate <Name> { <param> = <value>; … }` —
  reuses the assignment parser used in instance bodies; captures `nameSpan`.

All spans captured, consistent with existing declarations.

## 5. Graph model

`MetaKind` gains `Annotation = "annotation"` and `Package = "package"`.
`EdgeKind` gains `Annotated`.

- **Annotation definition** → Ontology-tier node, `typeOf = MetaKind.Annotation`;
  each param becomes a `HasField` member node (`<Ann>.<param>` with `name` /
  `type` / `cardinality` attrs) — identical to concept fields, so param typing
  and reference resolution reuse existing machinery.
- **Application** → Ontology-tier node id `<target>@<Ann>` (e.g. `actor@Icon`,
  `package@Author`), `typeOf = <Ann>`, with each `param = value` staged as a
  **scalar attr**. Linked to its target by `EdgeKind.Annotated`
  (`<target> —Annotated→ <target>@<Ann>`).
- **Package node** → a singleton Ontology-tier node, reserved id `package`,
  `typeOf = MetaKind.Package`. All `package { }` blocks (across files) merge onto
  it. Created only when package-level annotations exist.
- **Provenance** → every new node carries the `namespace` attr (the loader
  stamping added in the `model` work).

Ontology tier (not Instance) is the static/type-level guarantee: no Instance-tier
node references an application, so annotations are never materialized per
instance.

## 6. Builder + loader

Builder additions:

- `defineAnnotation(id)` — stage Ontology-tier node, `typeOf = MetaKind.Annotation`.
- `definePackageNode()` — stage the singleton package node (idempotent within a
  build; the loader ensures single creation across files).
- `annotate(target, annotationId)` — stage the application node
  `<target>@<annotationId>` (Ontology-tier, `typeOf = annotationId`) plus the
  `Annotated` edge `target → <target>@<annotationId>`; returns the application id
  so the caller can `setField` its params.
- Param values use the existing `setField` (scalar attrs).

Loader:

- **Pass 1** (bare types): `AnnotationDecl` → `defineAnnotation`. `PackageDecl`
  and concept-level applications are staged in the applications pass.
- **Pass 2a** (members): `AnnotationDecl` params → `addField(<Ann>, param.name,
  param.type, param.cardinality)`.
- **Applications pass** (after members commit, so annotation schemas exist): for
  each `ConceptDecl.annotations` and each `PackageDecl.annotations`, ensure the
  target node exists (concept already staged; package node via
  `definePackageNode`), then `annotate(target, name)` + `setField` each param.
  Track seen `<target>@<Ann>` ids; a repeat is **not** staged (the builder would
  throw on the duplicate node id) and instead emits `annotation.duplicate` at
  load time — the first application wins.
- **`collectNames`**: annotation names are defined names; each application's
  `name` is a reference site (undefined annotation → `reference.undefined`).
- **`recordSpans`**: annotation def span (by name); each application span (by
  `<target>@<Ann>`) and package span.

## 7. Validation

Two layers. **Duplicate** applications are caught at **load time** (§6
applications pass), because a repeated `<target>@<Ann>` id would otherwise throw
in `Builder.commit`; the loader skips the repeat and emits `annotation.duplicate`.
Everything else is a **validation pass** over every Ontology-tier node whose
`typeOf` is an annotation (an application), checking it against that annotation's
param schema — reusing the field-schema helpers, mirroring how `validateModel`
was added for `MetaKind.Model`.

`DiagnosticCode` gains two members:

```ts
AnnotationUnknownParam = "annotation.unknown-param",
AnnotationDuplicate    = "annotation.duplicate",
```

Checks (all error severity):

1. **Undefined annotation** — application `typeOf` names no `annotation` →
   **`reference.undefined`** (via the reference-site machinery; no new code).
2. **Unknown param** — an application attr not declared on the annotation →
   **`annotation.unknown-param`**.
3. **Missing required param** — a required (non-optional) annotation param absent
   → reuse **`cardinality.required-missing`**.
4. **Param value type mismatch** — a value violating its param's primitive type →
   reuse the existing primitive/type validation concept fields already run.
5. **Duplicate application** — the same annotation applied twice to one target →
   **`annotation.duplicate`**, emitted at load time (above); the repeat is not
   staged.

No target-legality check is required (structural, per §3). Spans point at the
application's `nameSpan` (or the offending param).

## 8. Emit

**Zero changes.** Annotation-def nodes, application nodes, `Annotated` edges, and
scalar param attrs round-trip through the existing `toJSON` / `fromJSON` /
`mergeBases` / `checkAgainst`. The compiled `model.json` simply carries the new
nodes/edges, which SP2/SP3 read.

## 9. Migration / back-compat

- `annotation`, `annotate`, and `package` become reserved — rename any concept /
  record literally named that (surface the breakage via the full suite, migrate
  fixtures, as in the `model` work).
- Additive to the graph model; existing meta-models without annotations are
  unaffected.
- Reserving keywords is a breaking surface change → **`@pragmatic-lab/todl`
  0.5.0**, republished to Verdaccio in SP1's release step; Plexus bumps when it
  consumes annotations (SP2).

## 10. Testing

All tests in `tests/` subfolders (`tsx --conditions=development --test`):

- **parser** — `annotation` → `AnnotationDecl` (params + spans); `annotate`
  inside a concept → `AnnotationApplication` on the concept; `package { }` →
  `PackageDecl`; reserved-keyword behavior.
- **loader** — annotation-def node (`MetaKind.Annotation`) with `HasField`
  params; application node (`<target>@<Ann>`, `typeOf`, scalar param attrs);
  `Annotated` edge; singleton package node + `package@<Ann>` applications;
  `namespace` provenance stamped on all.
- **validation** — `reference.undefined` (undefined annotation);
  `annotation.unknown-param`; `cardinality.required-missing` (missing required);
  param type mismatch; `annotation.duplicate`; and a fully-valid set producing no
  diagnostics.
- **emit** — annotation-def node, application node, `Annotated` edge, and param
  attrs survive `toJSON` → `fromJSON`.

## 11. Out of scope (SP1)

- Plexus projection into `MetaModelEntity.Annotations`, the shared per-concept
  type object, the `$Type` canvas hop, and `manifest.json` (SP2).
- Presentation-generator baking of well-known annotations and the generic
  bindable template; Mural converters (SP3).
- Non-scalar param types (lists, references, nested objects); `AllowMultiple`.
