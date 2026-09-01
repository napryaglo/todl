# TODL Language Service — Analysis Core Design (Spec 1 of 3)

**Parent:** [`2026-07-28-todl-language-server-design.md`](./2026-07-28-todl-language-server-design.md)
(umbrella architecture). This is **Spec 1 — the analysis core**; the LSP server (Spec 2) and
Plexus client (Spec 3) are separate specs that depend on this one.

**Goal:** A pure, transport-free analysis core that, given a set of TODL sources + resolved
base models, answers the full suite of LSP-shaped queries (completion, hover, definition,
references, document symbols, rename, semantic tokens, folding, workspace symbols, code
actions, formatting, signature help) as `vscode-languageserver-types`. No protocol, no
Monaco, no I/O — proven by exhaustive headless unit tests.

**Status:** ✅ Finished

---

## Resolved decisions

| Fork | Decision |
| --- | --- |
| Result types | Return **`vscode-languageserver-types`** directly (types-only dep, no runtime). |
| Position basis | Core converts TODL 1-based/exclusive spans → LSP 0-based at its boundary. |
| Caching | **None in the core** — `analyze()` is whole-project and pure; caching is the server's job. |
| Precise ref positions | Add **optional span fields to the compiler AST** (backward-compatible); land first. |
| Location | `src/language-service/`, exported as `@pragmatic-tech-ai/todl/language-service`. |

---

## Package & dependencies

- **New source folder** `src/language-service/` in the TODL repo, exposed via a new subpath
  export `@pragmatic-tech-ai/todl/language-service` in `package.json` `exports`.
- **Depends only on:** the compiler internals it already ships (`parse`, `load`, `Repository`,
  `tokenize`/`Token`/`TokenKind`, span types, `checkAgainst`, `MetaKind`, `Tier`,
  `Cardinality`) and **`vscode-languageserver-types`** (types-only; no runtime, no protocol).
- **Dependency direction:** the core imports the compiler; the compiler never imports the
  core. Enforced by directory boundary.
- **Tests:** `src/language-service/tests/` per the repo convention (`tsx --conditions=development --test`).

---

## Prerequisite — parser span-enrichment (compiler task)

Go-to-def, references, and rename need exact ranges for *reference* occurrences, but today's
AST omits them (`FieldDecl`/`RelationshipDecl` carry no spans; `extends`/`type`/`target` are
bare strings). Add **optional** span fields to the parse AST:

- `ConceptDecl.extendsSpan?`
- `FieldDecl.nameSpan?`, `FieldDecl.typeSpan?`
- `RelationshipDecl.nameSpan?`, `RelationshipDecl.targetSpan?`
- `NamespaceNode` import spans (a parallel `importSpans?: SourceSpan[]` or richer import nodes)
- `InstanceDecl.conceptSpan?`, `InstanceDecl.instanceOfSpan?`
- Ref-value spans on `RefValue` (the `&name` occurrence)

Optional fields keep this **backward-compatible** with the published 0.2.0 consumers (mirrors
the already-optional `AssignmentNode.span`); the loader is untouched. **This lands first**,
gated by the full existing TODL suite staying green after the change.

---

## Public API

One builder plus pure query functions. All results are `vscode-languageserver-types`.

```ts
analyze(sources: SourceFile[], bases?: TodlDocument[]): Analysis

interface Analysis {
  sources: Map<string, { ast: NamespaceNode; tokens: Token[] }>  // per-file parse + lex
  model: Repository                                              // combined symbol table
  refs: ReferenceIndex                                           // symbol id → occurrences
  diagnostics: Diagnostic[]                                      // checkAgainst, LSP-mapped
}

completionsAt(a: Analysis, uri: string, pos: Position): CompletionItem[]
hoverAt(a: Analysis, uri: string, pos: Position): Hover | null
definitionAt(a: Analysis, uri: string, pos: Position): Location | null
referencesAt(a: Analysis, uri: string, pos: Position, includeDecl: boolean): Location[]
documentSymbols(a: Analysis, uri: string): DocumentSymbol[]
prepareRename(a: Analysis, uri: string, pos: Position): Range | null
renameEdits(a: Analysis, uri: string, pos: Position, newName: string): WorkspaceEdit | RenameError
semanticTokens(a: Analysis, uri: string): SemanticTokens
foldingRanges(a: Analysis, uri: string): FoldingRange[]
workspaceSymbols(a: Analysis, query: string): WorkspaceSymbol[]
codeActions(a: Analysis, uri: string, range: Range, diags: Diagnostic[]): CodeAction[]
formatDocument(a: Analysis, uri: string): TextEdit[]
signatureHelpAt(a: Analysis, uri: string, pos: Position): SignatureHelp | null
```

`analyze()` is whole-project and pure; there is **no incremental cache in the core**.

---

## Core building blocks

### Position conversion (one boundary utility)

TODL spans are 1-based line/column with exclusive end; LSP is 0-based line/character. A single
`spanToRange(span)` / `positionToTodl(pos)` pair converts at the core's edge and is unit-tested
in isolation. **Nothing else in the core does 1↔0 math.**

### Cursor-context classifier

`classifyPosition(a, uri, pos): CursorContext` — a discriminated union over a `Role` enum:

- `TypeSlot` — a concept/primitive/enum name is expected (field type, `extends`).
- `RelationshipTarget` — a concept name is expected (`-> target`).
- `AssignmentName` — carries the owning concept id.
- `RefValue` — carries the expected target concept id (from the field/relationship schema).
- `ImportPath` — a namespace path is expected.
- `KeywordSlot` — top-level declaration keyword position.
- `Identifier` — a definition or reference occurrence; carries the resolved symbol id.
- `None` — whitespace/comment/unclassifiable.

It finds the token at `pos` in the file's `tokens`, locates the enclosing declaration via the
`ast`, and infers the role from grammar position. **This single function feeds completion,
hover, and definition.**

### Reference index

```ts
interface Occurrence { uri: string; range: Range; role: Role }
interface ReferenceIndex {
  get(id: NodeId): Occurrence[]
  occurrenceAt(uri: string, pos: Position): NodeId | null
}
```

Built once during `analyze()` by walking each file's enriched AST and classifying every
reference occurrence (extends, field type, relationship target, `&ref`, instance
concept/instanceof). Backs references, rename, and semantic tokens.

---

## Per-capability algorithms

All pure over `Analysis`, using the classifier + `Repository` + reference index.

- **Semantic tokens** — walk `tokens`; resolve each identifier's role via the reference index /
  classifier → LSP semantic-token type. Legend: `type` (concept), `class` (primitive/enum),
  `enumMember`, `property` (field), `method` (relationship), `variable` (instance/ref), with an
  `unresolved` modifier for names absent from the `Repository`. Replaces the Monarch guesswork.
- **Completion** — role-driven:
  - `TypeSlot` → `allNodes()` filtered to concepts/primitives/enums (by `tier` + `typeOf`→`MetaKind`).
  - `RelationshipTarget` → concept nodes.
  - `AssignmentName` → owning concept's `effectiveSchema()` field + relationship names, deduped
    against already-written assignments.
  - `RefValue` → expected target concept from schema, then `instancesOf` ∪ `instancesOfClass` ∪
    `termsOf` — **schema-aware value completion (standout feature)**.
  - enum value → that enum's case nodes.
  - `KeywordSlot`/top-level → the keyword set.
  - Items carry kind, resolved-type detail, and description doc.
- **Hover** — resolve the symbol id → markdown: kind + signature (concept shows `extends` +
  `effectiveSchema` members; field shows type + cardinality; instance shows concept + class) +
  description.
- **Definition** — symbol id → `spanOf(id)` → `Location` (cross-file via `span.uri`); member
  assignments via `memberKey(instance, member)`. Base symbol with no recorded span → `null`
  (the flagged no-op boundary).
- **References** — `refs.get(id)` → `Location[]`, optionally including the definition span.
- **Rename** — `prepareRename` returns the identifier range (or `null`). `renameEdits` validates
  the new name (kebab-case + no collision with an existing scoped id), then builds a
  `WorkspaceEdit` from the definition span + all reference occurrences; invalid name →
  `RenameError` the server maps to an LSP error.
- **Document symbols** — recursive AST walk → hierarchical `DocumentSymbol` tree (namespace →
  concepts/primitives/enums/instances → fields/relationships/terms/nested records), each with
  `range` + `selectionRange`.
- **Folding** — multi-line brace blocks from `tokens` → `FoldingRange[]`.
- **Workspace symbols** — fuzzy-match `query` against `allNodes()` ids → `WorkspaceSymbol[]`
  with `spanOf` locations.
- **Code actions** — switch on each diagnostic's `DiagnosticCode`: unresolved-reference →
  "create missing concept" (stub insert) + "add import"; name-case mismatch → "fix to
  kebab-case"; unused import → "remove import". Each emits a `CodeAction` with a `WorkspaceEdit`.
- **Formatting** — token-based reflow → `TextEdit[]`: indentation per brace depth, single space
  around `=`/`:`/`->`, `;` placement, blank line between declarations. Driven by the token
  stream so comments + layout survive. No AST re-emit.
- **Signature help** — cursor in an assignment value → the field/relationship's type +
  cardinality as one signature. Minimal; flagged low-value (TODL has no call syntax).

---

## Diagnostics mapping

`analyze()` runs `checkAgainst(bases, sources)` and stores the diagnostics mapped to
`vscode-languageserver-types` `Diagnostic` (severity map + `spanToRange`; a null span collapses
to document start, as the current renderer does). This is the same validation the in-renderer
service runs today, now produced by the core and consumed by the server (Spec 2).

---

## Testing (the real quality gate — fully headless)

`tsx --conditions=development --test`, fixtures in `src/language-service/tests/`:

- **Fixture helper:** parse `.todl` strings with `‸`-marked cursor positions, strip markers to
  real `Position`s, run `analyze()` once per fixture set.
- **Per capability:** completion asserts candidate sets at each marker (including the
  schema-aware `&ref` case and dedup); definition/references assert exact cross-file ranges;
  rename asserts the full `WorkspaceEdit` and rejects bad names; hover asserts rendered content;
  semantic tokens assert role classification incl. `unresolved`; document symbols assert the
  tree shape; code actions assert one emitted edit per diagnostic code; formatting asserts
  **idempotence** (`format∘format == format`) and comment preservation.
- **Unit tests:** the classifier (every `Role`), the reference index (`get` + `occurrenceAt`),
  and `spanToRange`/`positionToTodl` conversion in isolation.
- **Cross-file fixture:** a concept defined in file A, referenced in file B — exercises
  multi-uri navigation for definition/references/rename.

---

## Scope boundaries (Spec 1)

- **In:** every query function above, over the project's own sources, with base symbols
  contributing to completion + hover.
- **Flagged thin:** signature help (minimal); go-to-definition *into* a base symbol (no-op when
  the base carries no source span — compiled `TodlDocument` bases may lack spans).
- **Out (later specs):** the `vscode-languageserver` wrapper + document sync + transports
  (Spec 2); Monaco adapters, IPC, `WorkspaceEdit` application (Spec 3); incremental re-analysis.

---

## Open risks (Spec 1)

- **Parser enrichment ripple.** Optional-field additions must not disturb the loader or existing
  consumers. Mitigation: optional-only; run the full TODL suite green after the change.
- **Classifier accuracy at edit-time.** Mid-token / trailing-position cursors (e.g. immediately
  after `&` with no name yet) must classify robustly. Mitigation: direct classifier tests for
  empty/partial-token positions, including trigger-character cases.
- **Formatting comment preservation.** Token-based reflow must never drop or reorder comment
  trivia. Mitigation: idempotence + comment-preservation tests as hard gates.
