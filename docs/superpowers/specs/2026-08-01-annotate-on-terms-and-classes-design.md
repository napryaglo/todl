# `annotate` on taxonomy terms and classes — design (SP1)

## Goal

Let a TODL author apply an `annotate` application inside a **taxonomy `term`**
body and inside a **`class`** declaration, not only inside a `concept` body or a
`package` block. Annotations stay **type-level**: a concrete (non-class)
instance carrying `annotate` is a diagnostic.

The motivating example — a per-term icon — must compile clean:

```todl
namespace tech-architecture
{
    taxonomy actors : represents actor
    {
        description = "Classifies actors by trust boundary.";

        term internal
        {
            label = "Internal";
            description = "Authenticated party inside the enterprise.";
            annotate icon { path = "resources/ai_agent.svg"; }
        }
    }
}
```

## Scope

This is **SP1** of two cycles:

- **SP1 (this spec) — TODL language.** Parser, AST, loader, one new diagnostic,
  and `TODL/docs/todl-language.md`. The compiled `TodlDocument` gains
  `Annotated` edges whose source is a term node or a class node.
- **SP2 (separate cycle) — Plexus presentation.** Project per-term / per-class
  annotations into generated presentation (a term's `icon` drives its glyph),
  and correct the Plexus scaffold `todl-manual.md` line that says `annotate` is
  "legal only inside a concept body or a package block". Out of scope here.

## Why it is small

Two facts in the existing model make this nearly free:

1. A taxonomy **term is already a class node** in the graph — `defineTaxonomy`
   stages each term as an Instance-tier node, id `${taxonomy}.${term.id}`, with
   `class = true`, typed by the term's concept (`builder.ts:189-193`). A `class`
   declaration stages the same shape.
2. `builder.annotate(target, name)` stages the application node as
   **Ontology-tier**, typed by the annotation, plus an `EdgeKind.Annotated` edge
   `target -> app` (`builder.ts:88-92`). Because the app node is Ontology-tier
   and typed by the annotation, the validation loop's existing
   `validateAnnotationApplication` runs on it **regardless of what the target
   is** (`validate.ts:49-55, 135-166`).

So param validation (`annotation.unknown-param`, required-param
`cardinality.required-missing`) and duplicate detection (`annotation.duplicate`)
apply to the new targets with **no change**. The work is only: accept the syntax,
carry it on the AST, and stage the edge from the right target id.

## Design

### Parser (`src/parse/parser.ts`)

`parseAnnotationApplication` is already generic (`annotate <name> { p = v; … }`)
and is reused unchanged.

- **`parseTerm` body loop** (`parser.ts:527-538`): before the existing
  `tryParseTerm()` / assignment branches, add
  `if (this.checkKeyword("annotate")) { … push to term.annotations; continue; }`.
  The `annotate`-first ordering is required: `annotate icon` is two identifiers,
  which `tryParseTerm`'s `Identifier Identifier` lookahead would otherwise
  misread as a concept-led term named `annotate`.
- **`parseInstanceFrom` body loop** (`parser.ts:210-226`): before
  `expectIdentifier()`, add the same `checkKeyword("annotate")` branch, pushing
  onto `decl.annotations`. Applied uniformly to class and concrete instances;
  the type-level restriction is enforced in the loader (below) so the error
  message can be specific.

### AST (`src/parse/ast.ts`)

Add a field to two interfaces, mirroring `ConceptDecl.annotations`:

- `Term`: `annotations: AnnotationApplication[];`
- `InstanceDecl`: `annotations: AnnotationApplication[];`

Both are populated by the parser (empty array when none). Every existing
constructor of these literals sets `annotations: []`.

### Loader (`src/parse/loader.ts`)

The applications pass already stages concept and package annotations through
`stageApplications(builder, model, target, apps, seenApps, diagnostics)`
(`loader.ts:230-243, 483-511`). Extend it to the new targets:

- **Terms.** For each `TaxonomyDecl`, walk its terms recursively (the same
  recursion the loader already uses to record qualified term ids,
  `loader.ts:321-331`). For each term with annotations, call
  `stageApplications(builder, model, `${decl.name}.${term.id}`, term.annotations, …)`.
  Nested terms use their own qualified id.
- **Classes.** For each `InstanceDecl` with `isClass === true` and non-empty
  `annotations`, stage against the class node id the loader already computed when
  it staged the class. This includes class instances declared at top level and
  those nested in a `model` body.
- **Concrete instances.** For each `InstanceDecl` with `isClass === false` and
  non-empty `annotations`, push one `annotation.invalid-target` diagnostic per
  application (spanned to the application) and **do not** stage it.

`stageApplications` itself is unchanged — it already keys duplicates per target
in `seenApps` and stages the `Annotated` edge via `builder.annotate`.

### Diagnostics (`src/diagnostics/diagnostic.ts`)

Add one code to the annotation phase:

```ts
AnnotationInvalidTarget = "annotation.invalid-target",
```

Message form: `annotation "<name>" cannot be applied to concrete instance
"<id>" — annotations are type-level (allowed on concepts, taxonomy terms,
classes, and the package)`.

### Validation (`src/validate/validate.ts`)

No change. Term and class application nodes are Ontology-tier and typed by their
annotation, so the existing loop already routes them to
`validateAnnotationApplication`, which checks unknown params and required params
against the annotation's schema.

## Data flow

```
source ─parse→ Term.annotations / InstanceDecl.annotations
       ─load→  stageApplications(termNodeId | classNodeId, apps)
                 → builder.annotate → Ontology-tier `<target>@<name>` node
                                    + Annotated edge target→app
       ─validate→ validateAnnotationApplication (params) — unchanged
       ─emit→   TodlDocument: Annotated edges from term/class nodes
```

## Error handling

- `annotate` on a concrete instance → `annotation.invalid-target` (new), staged
  nowhere.
- Duplicate `annotate` of the same annotation on one target →
  `annotation.duplicate` (existing), first wins.
- Unknown annotation name → `reference.undefined` (existing, via
  `defineAnnotation`/resolve path).
- Unknown param / missing required param → `annotation.unknown-param` /
  `cardinality.required-missing` (existing).

## Testing

Tests live in `tests/` subfolders next to the code (`src/parse/tests/`,
`src/validate/tests/`), per the repo convention.

- **Parser** — `annotate` inside a `term` body parses onto `Term.annotations`;
  `annotate` inside a `class` body parses onto `InstanceDecl.annotations`; a
  term with both an `annotate` and nested sub-terms parses both (ordering /
  lookahead regression).
- **Loader** — a term-level `annotate icon { path = … }` produces an `Annotated`
  edge from `${taxonomy}.${term.id}` to an Ontology-tier `…@icon` node with
  `path` set; a `class`-level `annotate` produces the edge from the class node;
  a concrete-instance `annotate` yields exactly one `annotation.invalid-target`
  and no edge.
- **Validation** — an unknown param on a **term** annotation reports
  `annotation.unknown-param`; a missing required param reports
  `cardinality.required-missing`; a duplicate term annotation reports
  `annotation.duplicate`.
- **Fixture** — the `actors` / `internal` / `icon` snippet from the Goal section
  compiles with zero diagnostics.

## Out of scope

- Plexus presentation consumption of term/class annotations (SP2).
- The Plexus scaffold `todl-manual.md` correction (SP2 — it is a Plexus-repo
  file).
- `annotate` on concrete instances (deliberately rejected).
