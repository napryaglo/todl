# Model as a First-Class Entity — Design

**Status:** ✅ Finished
**Target package:** `@pragmatic-tech-ai/todl` (0.3.1 → **0.4.0**, breaking)
**Date:** 2026-08-01

## 1. Goal

Introduce `model` as a first-class core entity in the TODL language. A model is
the container that carries **objects** (concrete instances typed by a concept).
Only a model can carry objects: a concrete object declared outside any model is
an error. A model binds the vocabulary it may instantiate from — one meta-model
plus zero or more libraries — and every constructor an object uses must resolve
within that bound vocabulary.

This promotes today's `model m : ea { … }` surface (which currently parses as a
generic record whose `: ea` sets a `meta-model` field) into a real, enforced
construct.

## 2. Vocabulary and locked decisions

- **Object** — a concrete instance typed by a concept (`isClass = false`). The
  thing a model carries.
- **Constructor** — what an object is built from: a **concept** (fields only), a
  **class** (fixed values + its concept's fields), or a **taxonomy term** (a
  class). Classes and taxonomy terms are *definitions* that live in libraries;
  they are constructors, not objects, and are exempt from the containment rule.
- **Model** — a new core entity. An **Instance-tier** graph node typed by a new
  `MetaKind.Model` sentinel (not a user concept). Owns its objects via the
  existing `Contains` edge. **Multiple models per project**; each binds its own
  meta-model + libraries.
- **Containment rule** — a model is the outermost container. Objects may nest
  under other objects, but the root of any object tree must be a model. A
  top-level concrete object (outside any model) is a diagnostic. Definitions
  (`concept` / `taxonomy` / `primitive` / bare `class`) and transparent wrappers
  (`technology-library`) remain legal at top level.
- **Object-construction syntax is unchanged.** This spec adds the `model`
  container and enforcement only. The "constructor-first" sugar
  (`azure us-east { }` instead of `location us-east instanceof azure`) is a
  separate, future grammar change and explicitly out of scope.

## 3. Surface syntax

```
namespace acme.deployment {
  import ea.core
  import cloud.aws

  model prod : enterprise-architecture uses aws-catalog, ea-patterns {
    component checkout {
      name = "Checkout"
    }
    component payments instanceof payment-service {
      name = "Payments"
    }
    region us-east {                 // objects nest under objects…
      component edge-cache { name = "Edge" }
    }
  }
}
```

Grammar: `model <id> : <meta-model> [uses <lib>[, <lib>]…] { <objects> }`

- `: <meta-model>` — reuses today's colon-binding; exactly one meta-model,
  **required**.
- `uses <lib>, …` — new contextual keyword; optional; comma-separated library
  list (a model may `uses` nothing and draw only on the meta-model).
- Body — object declarations in **exactly the instance syntax used today**
  (`<concept> <id> [instanceof <class>] { assignments; children }`).

`model` becomes a **reserved contextual keyword.**

## 4. AST + parser

`DeclKind` gains `Model`. New AST node:

```ts
export interface ModelDecl {
  kind: DeclKind.Model;
  id: string;
  metaModel: string;         // required `: <meta-model>`
  libraries: string[];       // `uses …`, possibly empty
  instances: InstanceDecl[]; // contained objects
  span: SourceSpan;
  idSpan?: SourceSpan;
  metaModelSpan?: SourceSpan;
  librarySpans?: SourceSpan[]; // parallel to libraries
}

export type Declaration =
  | ConceptDecl | TaxonomyDecl | PrimitiveDecl | InstanceDecl | ModelDecl;
```

Parser: in the declaration dispatcher (`parseDeclaration`), add
`if (this.checkKeyword("model")) return this.parseModel(start)` **before** the
generic-instance fallback. `parseModel`:

1. consume `model`, read the id (span captured);
2. `expect(":")`, read the meta-model identifier (span captured);
3. if the next token is the `uses` keyword, consume it and read a
   comma-separated identifier list (spans captured, parallel array);
4. `{` … `}` body: parse each member with the existing `parseInstanceFrom`,
   collecting them into `instances`.

Every span is captured, consistent with the reference-undefined work.

**Consequence:** `model` used as a concept/record *name* no longer parses. Today
`model m : ea { … }` keeps its surface (same tokens) but now yields a
`ModelDecl` instead of an `InstanceDecl` with `binds`.

## 5. Graph / data model

`MetaKind` gains `Model = "model"`. The model node:

```
{
  tier:   Tier.Instance,
  typeOf: MetaKind.Model,           // sentinel, not a concept
  attrs:  {
    id:           <id>,
    "meta-model": <name>,           // scalar
    "uses.count": <n>,              // number of libraries
    "uses.0": <lib0>, "uses.1": <lib1>, …,   // ordered library list
    namespace:    <namespace-path>, // provenance (see §6)
  },
}
```

- Instance-tier so it's not a schema element, but typed by the `Model` sentinel
  so it stays **out of every `instancesOf(<concept>)` bucket** while
  `instancesOf(MetaKind.Model)` enumerates all models — the same partition the
  emitter already uses for `MetaKind.Concept`.
- Contained objects hang off the model by the **existing** `Contains` edge
  (`model —Contains→ object`). No new edge kind.
- The `uses` list is stored as ordered indexed scalar attrs (`uses.0…N` +
  `uses.count`). It only needs to be *read back* by the scope validator (§7), not
  graph-traversed, so this keeps the `Graph`/`Scalar` contract untouched.

## 6. Provenance (per-node `namespace` attr)

Constructor-scope checking needs to know which module (meta-model or library)
provides each concept/class/term. Today `mergeBases` merges all bases into one
graph with **no origin tracking**. We add provenance as a **per-node `namespace`
scalar attr**:

- The **loader** sets `namespace` on every node it stages, from that
  declaration's enclosing namespace path. (Today the loader flattens
  `sources.flatMap(source => declarations)` and loses which namespace each
  declaration came from; it must thread the namespace path through to
  `applyInstance` / the ontology-staging paths.)
- **Base nodes** already carry the attr from when they were emitted, so they
  survive deserialization unchanged.
- Per-node (not per-document) because a compiled base can **bundle multiple
  modules** — e.g. a library carrying its meta-model (a case `mergeBases`
  already documents). Each bundled node keeps its true origin namespace, so a
  meta-model concept re-shipped inside a library is still attributed to the
  meta-model.

Because `emit` already serializes `attrs` and `mergeBases` rebuilds them via
`new Map(Object.entries(node.attrs))`, the `namespace` attr **round-trips
through `toJSON` / `fromJSON` / `mergeBases` for free** — no `TodlDocument`
schema change, no `checkAgainst` signature change.

"Module X provides node N" ≡ "N's `namespace` attr == X". A bound name resolves
iff at least one loaded node carries that namespace.

## 7. Validation — three new diagnostics

New `DiagnosticCode` members:

```ts
InstanceOrphan       = "instance.orphan",
ModelBindingUndefined = "model.binding-undefined",
ConstructorOutOfScope = "constructor.out-of-scope",
```

All error severity.

1. **`instance.orphan`** — a concrete object (`isClass = false` `InstanceDecl`)
   with **no `model` ancestor** in the declaration tree. Detected at **load
   time** from declaration nesting (no graph walk); the span points at the
   object's concept. This catches the common case (a top-level object) and the
   nested case (an object buried under a top-level class or transparent wrapper
   — still no model ancestor). Definitions (`concept` / `taxonomy` / `primitive`
   / bare `class`) and wrappers themselves stay legal; only concrete objects
   need a model ancestor.
2. **`model.binding-undefined`** — the model's `: meta-model` name, or a `uses`
   name, matches **no** loaded module (no node carries that `namespace`). Span:
   the offending meta-model / library identifier.
3. **`constructor.out-of-scope`** — an object's constructor is not provided by
   the model's bound set. The bound set is `{ meta-model } ∪ uses`. Both the
   object's `concept` and, when present, its `instanceof` class/term are
   checked; each is in-scope iff its provider `namespace` is in the bound set.
   Span: the offending constructor identifier.

**Graceful degradation:** a node with **no `namespace` attr** (an old base
published before this change) is **skipped by the scope check** — never a false
`constructor.out-of-scope`. `model.binding-undefined` and `instance.orphan` are
unaffected. Republishing bases restores full checking.

## 8. Loader

New `DeclKind.Model` branch:

1. Stage the model node (Instance-tier, `typeOf = MetaKind.Model`); set `id`,
   `meta-model`, `uses.count`, `uses.0…N`, and `namespace` attrs.
2. Recurse each contained `InstanceDecl` through the existing `applyInstance`
   with the model id as `parent`, so objects get their normal `Contains` +
   field / relationship / `instanceof` treatment, rooted at the model.
3. Every staged node (model, objects, and ontology nodes on the definition
   paths) receives the `namespace` attr (§6).

Orphan detection walks the top-level declarations: a `model` subtree is legal
(all its descendant objects have a model ancestor), so it is skipped. Any other
top-level declaration is scanned for concrete objects (`isClass = false`
`InstanceDecl`) — the declaration itself if it is one, or objects nested inside
a class / wrapper — and each such object emits `instance.orphan`. Equivalently:
any concrete object reached without passing through a `model` is an orphan.

## 9. Emit

`toJSON` shape is **unchanged** — the `namespace` attr flows through the existing
attr serialization. The model node emits like any node (Instance-tier,
`typeOf: "model"`, its attrs) with its `Contains` edges, so a compiled model
round-trips. `fromJSON` / `mergeBases` need no changes.

## 10. Migration / back-compat

- `model` is reserved — rename the `concept model { … }` test fixture and any
  record literally named `model`.
- **Libraries** (concepts / taxonomies / classes / primitives, including
  `technology-library` wrappers holding classes) are unaffected — no concrete
  objects.
- Files with **top-level concrete objects** must be wrapped in
  `model … : … { }` or they raise `instance.orphan`. Existing `model m : ea { }`
  fixtures keep their surface (now a `ModelDecl`).
- **Old compiled bases** lack `namespace` attrs → scope check skips their nodes
  (graceful degradation, §7). Republishing restores full checking.
- Breaking language change → **`@pragmatic-tech-ai/todl` 0.4.0**, republish to
  Verdaccio; Plexus bumps its dependency.

## 11. Testing

All tests live in `tests/` subfolders (project convention). Coverage:

- **parser** — `model` parses to `ModelDecl` (id / metaModel / libraries + all
  spans); `uses` list and empty `uses`; nested objects; `model` reserved (a
  `concept model` no longer parses).
- **loader** — model node tier (`Instance`) + `typeOf` (`Model`); `Contains`
  edges to objects; `meta-model` / `uses.*` / `namespace` attrs; namespace
  attr set on objects and ontology nodes.
- **validation** — `instance.orphan` fires for a top-level object **and** for an
  object nested under a top-level class/wrapper (no model ancestor), and passes
  for an object nested directly and transitively under a model; a top-level
  class is OK; `model.binding-undefined` for an unknown meta-model and an unknown
  `uses`; `constructor.out-of-scope` fires for a concept not from the
  meta-model and a class not from a used library, and passes for in-scope
  constructors; missing-`namespace` nodes are skipped.
- **emit / json** — `namespace` attr and the model node round-trip through
  `toJSON` / `fromJSON`.
- **api** — `checkAgainst` end-to-end: a compiled meta-model base + a compiled
  library base + a model source; in-scope constructors clean, out-of-scope
  flagged.

## 12. Implementation sequencing (one spec, two layers)

The change is naturally two sequenced layers within this single spec, and the
implementation plan should stage it so:

1. **Model construct + containment** — AST `ModelDecl`, `MetaKind.Model`, parser
   `parseModel`, loader model branch, `instance.orphan`. Stands alone and
   testable without provenance.
2. **Provenance + scope** — per-node `namespace` attr (loader tagging + emit
   round-trip), `model.binding-undefined`, `constructor.out-of-scope`, graceful
   degradation. Builds on layer 1.
