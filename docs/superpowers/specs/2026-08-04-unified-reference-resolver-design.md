# Unified Reference & Symbol Resolver — Design

**Date:** 2026-08-04
**Status:** ✅ Finished — Implemented (4 stages) + published 0.12.0
**Package:** TODL (`@pragmatic-tech-ai/todl`)

## Problem

Symbol handling is fragmented three ways (map from investigation):

1. **Parser accepts qualified names clause-by-clause.** `parseDottedPath()` at
   some sites (taxonomy `represents`/`uses`, model bindings, `&refs`),
   `expect(Identifier)` (bare-only) at others (concept `extends`, field type,
   relationship target, record concept, `instanceof`, instance meta-model
   binding, annotation param/name). Every new clause risks rejecting `ns.x` —
   this is the recurring authoring bug.
2. **References are scattered bare `string` fields** with parallel `SourceSpan[]`
   arrays (`represents`+`representsSpans`, `libraries`+`librarySpans`, …). No
   unified reference representation. The loader (`RefSite`) and the
   language-service (`reference-index`) each **re-walk the AST separately** to
   re-collect "what is a reference."
3. **`validate.ts` is a second, weaker resolver** for model bindings +
   constructor scope — a plain namespace-presence scan that doesn't share the
   loader's namespace/import logic.

Resolution itself is otherwise already unified: the language-service resolves
names through the loader-built `model` (`model.resolve()`), and the loader's
`resolveRef` is the single name→node resolver.

The AST types are **internal** — Plexus consumes only the model
(`check`/`checkAgainst`/`toJSON`/`Repository`/`TodlDocument`), never AST decl
types; only TODL's own language-service reads the AST. So restructuring the AST
is not a downstream-breaking change.

## Design

### 1. A unified `Reference` AST node (`src/parse/ast.ts`)

```ts
export enum RefRole {
  Extends, FieldType, RelationshipTarget, Represents, Uses,
  RecordConcept, InstanceOf, MetaBinding, ModelMetaModel, ModelUses,
  RefValue, NameValue, AnnotationName,
}
export interface Reference {
  name: string;          // as written — bare or qualified (`ns.x`)
  span: SourceSpan;
  role: RefRole;
  resolved?: string;     // the flat id after loader resolution (rewrite target)
}
```

Replace the scattered bare-string reference fields + parallel span arrays:

| Decl | before | after |
|---|---|---|
| ConceptDecl | `extends: string\|null` + `extendsSpan?` | `extends: Reference \| null` |
| FieldDecl | `type: string` + `typeSpan?` | `type: Reference` |
| RelationshipDecl | `target: string` + `targetSpan?` | `target: Reference` |
| TaxonomyDecl | `represents: string[]` + `representsSpans?`; `uses: string[]` + `usesSpans?` | `represents: Reference[]`; `uses: Reference[]` |
| InstanceDecl | `concept: string` + `conceptSpan?`; `instanceOf: string\|null` + `instanceOfSpan?`; `binds: string\|null` | `concept: Reference`; `instanceOf: Reference \| null`; `binds: Reference \| null` |
| ModelDecl | `metaModel: string` + `metaModelSpan?`; `libraries: string[]` + `librarySpans?` | `metaModel: Reference`; `libraries: Reference[]` |
| ValueNode (Ref/Name) | `ref: string`+`span?` / `name: string` | Ref/Name values carry a `Reference` (value refs into terms/records) |
| AnnotationApplication | `name: string` + `nameSpan?` | keep `name` for the annotation identity, add `ref: Reference` |

Declaration *name* fields (a decl's own id) stay bare strings — they are
definitions, not references.

### 2. One `parseReference(role)` in the parser

```ts
private parseReference(role: RefRole): Reference {
  const start = this.current();
  const name = this.parseDottedPath();      // dotted-capable; bare still parses
  return { name, span: this.spanFrom(start), role };
}
```

Used at **every** reference-target site (the ~13 sites in the table above),
replacing every `expect(Identifier)`/`parseDottedPath()`+span pair. Qualified
names become uniformly acceptable across the whole language in one place.

### 3. One reference-walk (`src/parse/references.ts`)

A single generator over a `Declaration`/`NamespaceNode` yielding every
`Reference` with a `rewrite(flatId)` hook (mutates `resolved` + the underlying
field). BOTH the loader's `RefSite` collection AND the language-service's
`reference-index` derive from this one walk — no more duplicate AST traversals.

```ts
export interface RefOccurrence { ref: Reference; owner: NodeId; home: Home; scope?: TermScope; }
export function* references(ns: NamespaceNode): Iterable<RefOccurrence> { … }
```

The loader feeds occurrences to the resolver; the reference-index maps
`ref.span → ref` for find-references / hover / go-to-definition. `RefRole`
subsumes the reference-index's existing `Role` enum.

### 4. One resolver module (`src/resolve/resolver.ts`)

Extract the loader's `resolveRef` / `reachable` / `nsOf` / `Home` into a
standalone module (no behavior change). Exposed API:

```ts
export interface Home { ns: string; imports: readonly string[]; }
export function makeResolver(model: Repository, defined: ReadonlySet<string>,
  sourceNs: ReadonlyMap<string, string>, reserved: ReadonlySet<string>): {
    resolveRef(name: string, home: Home): Resolved;
    reachable(id: string, home: Home): boolean;
    nsOf(id: string): string | null;
  };
```

- **Loader** uses it for every reference occurrence (as today).
- **`validate.ts`** uses `reachable`/`nsOf` for its model-binding +
  constructor-scope checks instead of its own namespace-presence scan — one
  namespace-reachability law. (Model *binding* stays a namespace-existence
  question — a distinct axis from name→node — but expressed via the shared
  `nsOf`/namespace set, not a private re-scan.)

## Staging (each stage ends green)

1. **Resolver module** — extract `resolver.ts` from the loader; loader delegates
   to it. Pure move, no behavior change. Full suite green.
2. **`Reference` type + `parseReference` + AST conversion** — add the type,
   route every parse site through `parseReference`, convert AST fields, update
   ALL consumers (loader, `emit`, `validate`, language-service
   reference-index/definitions/classifier) to read `.name`/`.span`/`.role`.
   This is the large mechanical stage; land it atomically. Green.
3. **Single reference-walk** — introduce `references.ts`; the loader and the
   reference-index both consume it, deleting their bespoke walks. Green.
4. **validate on shared resolver** — fold `boundModules`/`flagBinding`/
   `checkConstructor` onto `resolver.ts` primitives. Green.

## Backward-compat / rollout

- Internal AST change only — no Plexus/Mural API impact (they use the model).
- Parser gains qualified-name acceptance everywhere (additive for authors; bare
  names still parse). No new *errors* beyond what namespace-scoped resolution
  0.11.0 already introduced.
- Publish `@pragmatic-tech-ai/todl@0.12.0`; bump Plexus (only rebuild — no source
  change needed there); the vendored language-server bundle rebuilds from it.

## Testing

- Parser: every reference site accepts `ns.x` and bare (one parametrized test
  over roles).
- Resolver module: unit tests moved/kept from the loader's namespace-scoped
  suite (behavior identical).
- Reference-walk: yields the expected occurrences for a fixture covering all
  `RefRole`s; loader + reference-index agree (same spans).
- validate: model-binding + constructor-scope diagnostics unchanged.
- Full corpus regression (microsoft + meta-model) stays green + identical model.

## Out of scope

- Changing resolution *semantics* (the 0.11.0 namespace gate stays as-is).
- Namespace aliases / transitive imports.
- Qualifying node ids (still flat).
