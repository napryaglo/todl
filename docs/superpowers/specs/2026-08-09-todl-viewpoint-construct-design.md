# TODL Viewpoint Language Construct — Design (Sub-project 1)

**Status:** Design. First sub-project of the viewpoint-scoped multi-file
architecture model effort (parent design lives in Plexus:
`docs/superpowers/specs/2026-08-09-viewpoint-multifile-architecture-model-design.md`).

**Date:** 2026-08-09

## 1. Goal

Add a first-class meta-model construct `viewpoint <Name> : frames <Concept>, …`
to TODL. A viewpoint is an ontology-tier entity that lists the concepts (element
types) it "frames" — the exact structural analogue of
`taxonomy <Name> : represents <Concept>, …`, minus terms/hierarchy. The compiled
`Repository` can then be queried for viewpoints and their framed concepts, and
authored viewpoints validate.

This is the vocabulary layer only. No `conforms`, no models, no multi-file, no
Plexus — those are later sub-projects that consume these queries.

## 2. Surface syntax

```
viewpoint <Name> : frames <Concept> [, <Concept>]*
```

- A top-level declaration inside a `namespace`, alongside `concept`/`taxonomy`.
- Mirrors `taxonomy Name : represents …`: the `:` precedes the `frames` keyword.
- **No body block** — a viewpoint has no terms (unlike taxonomy's `{ … }`). The
  declaration ends after the frames list; the next token is another declaration
  keyword or the namespace `}`.
- Frames targets may be namespace-qualified (`ns.Concept`); resolution strips the
  prefix, exactly like taxonomy `represents` targets.

Example (in a meta-model):
```todl
namespace archmm {
  concept Component {}   concept Node {}   concept Interface {}
  viewpoint ComponentView  : frames Component, Interface
  viewpoint DeploymentView : frames Node, Component
}
```

## 3. Design — mirror the taxonomy construct

Every piece parallels the existing `taxonomy`/`represents` implementation. Exact
sites (from the current taxonomy map):

### 3.1 AST & parser
- **`DeclKind.Viewpoint`** — add to the enum in `src/parse/ast.ts`.
- **`ViewpointDecl`** interface in `src/parse/ast.ts`, added to the `Declaration`
  union:
  ```ts
  export interface ViewpointDecl {
    kind: DeclKind.Viewpoint;
    name: string;
    frames: string[];
    framesSpans?: SourceSpan[];
    span: SourceSpan;
    nameSpan?: SourceSpan;
  }
  ```
- **`viewpoint` keyword** — register wherever `taxonomy` is a keyword
  (`src/parse/tokens.ts` `KEYWORDS`, if keywords are enumerated there).
- **`parseViewpoint`** in `src/parse/parser.ts`, dispatched next to
  `if (this.checkKeyword("taxonomy")) …`. Body: expect `viewpoint`, read name,
  expect `:`, expect `frames`, then the same comma-separated
  `parseDottedPath()` loop taxonomy uses for `represents` (capturing
  `framesSpans`). No `uses`, no term/body parsing. Return the `ViewpointDecl`.

### 3.2 Model representation
- **`MetaKind.Viewpoint = "viewpoint"`** in `src/model/kinds.ts` (lowercase
  string value, consistent with the other kinds).
- **`EdgeKind.Frames`** in `src/model/graph.ts` — the one new edge kind (append
  to the enum so existing numeric values are unchanged). A viewpoint → each
  framed concept, `via: null`, exactly like `EdgeKind.Represents`.
- **`Builder.defineViewpoint(name, frames)`** in `src/model/builder.ts`,
  mirroring `defineTaxonomy` minus terms:
  ```ts
  defineViewpoint(name: NodeId, frames: readonly NodeId[]): this {
    this.stageNode(name, Tier.Ontology, MetaKind.Viewpoint);
    for (const concept of frames)
      this.stagedEdges.push({ kind: EdgeKind.Frames, via: null, from: name, to: concept });
    return this;
  }
  ```

### 3.3 References & loader
Frames targets are resolved through the **same** `visitReferences` machinery
that resolves taxonomy `represents` (references.ts:65-69) — NOT an explicit
resolution loop. This means qualified `ns.C` frames rewrite to flat ids, and an
unknown/unreachable frame yields the generic `reference.undefined` /
`reference.unreachable` diagnostic and its dangling `Frames` edge is dropped by
`Builder.commit`, exactly like a bad `represents` target.

- **`src/parse/references.ts`**
  - `RefRole.Frames` — add to the `RefRole` enum (mirroring `RefRole.Represents`).
  - `collectDefinitions`: `case DeclKind.Viewpoint: define(decl.name); break;`.
  - `visitReferences`: `case DeclKind.Viewpoint:` visiting each `decl.frames[i]`
    with `role: RefRole.Frames`, `span: decl.framesSpans?.[i] ?? decl.span`,
    `ownerNode: decl.name`, `rewrite: (r) => { decl.frames[i] = r; }` — the exact
    shape of the `represents` visit.
- **`src/parse/loader.ts`**
  - Pass 1 — `case DeclKind.Viewpoint: first.defineViewpoint(decl.name, decl.frames); break;`.
  - `recordSpans` — `case DeclKind.Viewpoint: model.recordSpan(declaration.name, declaration.span); break;`.

No explicit frames loop, no `isConcept` loader helper — the concept-type check
lives in validation (§3.5), where a frame that *resolves* but is not a concept
(e.g. a taxonomy) is caught.

### 3.4 Repository queries (`src/model/model.ts`)
Add, mirroring `represents`/`representedBy`:
```ts
frames(viewpoint: NodeId): NodeId[]          // graph.related(vp, EdgeKind.Frames, Out)
framedBy(concept: NodeId): NodeId[]          // graph.related(concept, EdgeKind.Frames, In)
viewpoints(): NodeId[]                        // all Viewpoint-typed ontology nodes
```
Plus **subtype-aware framing** (parent design §8): `framedBy` membership must walk
subtypes, so a concept whose supertype is framed counts as framed. Provide the
inverse the consumer needs:
```ts
// every viewpoint that frames `concept` OR any of its supertypes
viewpointsFraming(concept: NodeId): NodeId[]
```
implemented via `[concept, ...supertypesOf(concept)]` ∪ `framedBy`, reusing the
existing `supertypesOf`.

### 3.5 Validation (`src/validate/validate.ts`, `src/diagnostics/diagnostic.ts`)
- **DiagnosticCodes** — add `ViewpointNoFramedConcept = "viewpoint.no-framed-concept"`
  and `ViewpointFramesNotConcept = "viewpoint.frames-not-concept"`.
- **`checkFrames`** in `validate.ts`, dispatched for
  `node.tier === Ontology && node.typeOf === MetaKind.Viewpoint`, mirroring
  `checkRepresents`: flag `ViewpointNoFramedConcept` when `frames(id)` is empty;
  flag `ViewpointFramesNotConcept` for any framed id whose resolved node is not a
  concept. (The loader loop catches unresolved/non-concept at parse time; this is
  the structural backstop for graph-built or base-composed models.)

### 3.6 Runtime emit — DEFERRED (no consumer)
The `.todl` model emitter does NOT emit ontology-tier constructs (taxonomies
aren't round-tripped to `.todl`), so viewpoints aren't `.todl`-emitted either —
they're authored by hand in meta-model source. A parallel JS-module emit
(`emitViewpoint` + a `viewpoints` registry, mirroring `emitTaxonomy`) is possible
but **out of scope here (YAGNI)**: Plexus and the other sub-projects consume
viewpoints from the `TodlDocument` graph JSON, where viewpoint nodes + `Frames`
edges already flow through `Repository.frames()`/`viewpoints()` with no special
emit. Add JS-module emit only when a typed-runtime consumer actually needs it.

## 4. File-by-file change list

| File | Change |
|------|--------|
| `src/parse/ast.ts` | `DeclKind.Viewpoint`; `ViewpointDecl`; add to `Declaration` union |
| `src/parse/tokens.ts` | register `viewpoint` keyword (if keywords enumerated) |
| `src/parse/parser.ts` | `parseViewpoint` + dispatch (+ decl-start lookahead list) |
| `src/parse/references.ts` | `RefRole.Frames`; `collectDefinitions` + `visitReferences` cases |
| `src/parse/loader.ts` | Pass-1 case; `recordSpans` case |
| `src/model/kinds.ts` | `MetaKind.Viewpoint` |
| `src/model/graph.ts` | `EdgeKind.Frames` (append) |
| `src/model/builder.ts` | `defineViewpoint` |
| `src/model/model.ts` | `frames`, `framedBy`, `viewpoints`, `viewpointsFraming` |
| `src/validate/validate.ts` | `checkFrames` + dispatch |
| `src/diagnostics/diagnostic.ts` | two new `DiagnosticCode`s |

## 5. Tests (each in a `tests/` subfolder next to source)

- `src/parse/tests/viewpoint-parse.test.ts` — parse `viewpoint X : frames A, B`
  → `ViewpointDecl` with `frames`/`framesSpans`; qualified `ns.C` targets; single
  and multiple frames; no-body termination before the next declaration.
- `src/parse/tests/viewpoint-load.test.ts` — loads with `MetaKind.Viewpoint` node
  + `Frames` edges; `frames("X")` returns the concepts; unknown frame →
  `reference.undefined`/`ViewpointFramesNotConcept` + no dangling edge; qualified
  frame resolves + rewrites; a frame that is a taxonomy/primitive →
  `ViewpointFramesNotConcept`.
- `src/validate/tests/viewpoint-validate.test.ts` — a graph-built viewpoint with
  no frames → `ViewpointNoFramedConcept`; a non-concept frame →
  `ViewpointFramesNotConcept`.
- `src/model/tests/…` — `frames`, `framedBy`, `viewpoints`, and subtype-aware
  `viewpointsFraming` (a subtype of a framed concept is framed).

## 6. Out of scope

`conforms`, the model `conforms` clause, multi-file model composition, per-file
provenance, `ModelDraft.fromSources`/`toTodlByFile`, and everything Plexus-side
(sub-projects 2–4).

## 7. Constraints

- ESM, strict tsconfig; run tests via
  `tsx --conditions=development --test "src/**/*.test.ts"`.
- Real TS enums (`DeclKind`, `MetaKind`, `EdgeKind`, `DiagnosticCode`) — extend
  the existing enums, never string-literal unions.
- Every test file in a `tests/` subfolder next to its source.
- Append `EdgeKind.Frames` at the enum's end so existing numeric edge-kind values
  (serialized in `TodlDocument` JSON) are unchanged.
