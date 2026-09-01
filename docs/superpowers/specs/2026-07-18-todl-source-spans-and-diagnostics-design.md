# TODL Source Spans, Unified Diagnostics & Parser Recovery — Design

**Status:** ✅ Finished

Captured 2026-07-18. This is an **implementation spec** for sub-project 1 of the
Plexus "meta-model project type" effort. Plexus will let a human author a
meta-model as `.todl` files in the Monaco editor with live, inline validation.
That requires TODL to report *where* each problem is (a source span) and to
survive syntax errors (report many, not throw on the first). This spec covers
only the TODL changes; the Plexus project type is a separate follow-on spec
(sketched at the end).

## Goal

Every diagnostic TODL produces — from lexing, parsing, or validation — carries a
`SourceSpan` (file + start/end line/column), and `parse()`/`load()` recover from
syntax errors and return a diagnostic list instead of throwing on the first one.
Then publish `@pragmatic-tech-ai/todl` to the local registry so Plexus can consume it.

## Why (the consuming need)

Plexus maps TODL diagnostics to Monaco editor markers. A marker needs a range
(`startLineNumber`, `startColumn`, `endLineNumber`, `endColumn`) and the file it
belongs to. Today's `Diagnostic` (`{ code, severity, node, path, message }`) has
no position, `parse()` throws on the first syntax error, and
`load(sources: string[])` merges all files losing per-file origin. All three gaps
must close.

## Current state (verified)

- `src/parse/lexer.ts` — `Token { kind, value, line, column }`. Start position is
  present; there is no stored end/length (end is derivable from `value`). Line
  and column are 1-based. Triple-quoted raw strings (`"""`) exist, so a token's
  value can span multiple lines.
- `src/parse/parser.ts` — `parse(source): NamespaceNode`. On any syntax error it
  does `throw this.error(msg)` (fail-fast, first error only). AST nodes carry no
  span.
- `src/parse/loader.ts` — `load(sources: string[]): Model`; its only work is
  `sources.flatMap(s => parse(s).declarations)` then a two-pass model build. This
  is the sole internal caller of `parse()`.
- `src/validate/validate.ts` — `validate(model: Model): Diagnostic[]`;
  `Diagnostic { code, severity, node, path, message }`; `DiagnosticCode` has
  `cardinality.*`, `relationship.*`, `invariant.*` (semantic only).
- `src/index.ts` — public surface exports `load`, `parse`, `validate`, `Severity`,
  `DiagnosticCode`, `Diagnostic`, `tokenize`, `Builder`, `Model`, etc.

## Design

### 1. Span & unified diagnostic types

New shared types (own module, e.g. `src/diagnostics/span.ts` / re-exported from
`src/index.ts`):

```ts
export interface Position { line: number; column: number }   // both 1-based
export interface SourceSpan { uri: string; start: Position; end: Position }
```

Extend the existing `Diagnostic` (kept as the single diagnostic type across all
phases — lex, parse, validate):

```ts
export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  span: SourceSpan | null;      // NEW — null only for genuine whole-model diagnostics
  node: NodeId | null;          // semantic phase; null for syntax diagnostics
  path: string | null;          // semantic phase; null for syntax diagnostics
}
```

Extend `DiagnosticCode` with syntax members, e.g.:

```ts
  UnexpectedToken   = "syntax.unexpected-token",
  ExpectedToken     = "syntax.expected",
  UnterminatedString= "syntax.unterminated-string",
```

Rationale for one type: Plexus wants one `Diagnostic[]` to fan out to markers; a
split type would force it to normalize two shapes.

### 2. Spans through the pipeline

**Lexer.** Keep `Token`'s start `line`/`column`. Add a span helper that computes
a token's end position from its `value`: for single-line tokens `end.column =
column + value.length`; for values containing newlines (raw strings), advance
`end.line` by the newline count and set `end.column` to the length of the last
line + 1. (No new `Token` field required; a `tokenSpan(token, uri)` helper
suffices. Optionally store `endLine`/`endColumn` on `Token` if that reads
cleaner during implementation.)

**Parser.** Every AST node gains `span: SourceSpan`. The parser records the span
from the first token consumed for a node to the last, using the `uri` threaded in
(see §3). `NamespaceNode`, every `Declaration` variant (`Primitive` / `Enum` /
`Concept` / `Instance`), and member nodes (fields, relationships, invariants,
assignments) carry it.

**Loader → Model.** When the two-pass build creates a Model node from a
declaration, record its defining span in a `Map<NodeId, SourceSpan>` held on the
`Model` (e.g. `Model.spanOf(id): SourceSpan | undefined`). Member-level spans
(field/relationship/invariant) are recorded keyed by their concept-qualified
path so a member diagnostic resolves to the member, not the whole concept.

**Validator.** `validate()` attaches a span to each diagnostic by looking up the
offending `node` (and `path` when member-level) via `Model.spanOf`. No validation
*logic* changes — only span enrichment on the emitted diagnostics.

### 3. File attribution + recovery (API changes)

`SourceFile` becomes the input unit so origin survives:

```ts
export interface SourceFile { uri: string; text: string }
```

**`parse` — recovers, never throws for syntax:**

```ts
export interface ParseResult { namespace: NamespaceNode; diagnostics: Diagnostic[] }
export function parse(text: string, uri: string): ParseResult
```

On a syntax error the parser records a `syntax.*` diagnostic (with the current
token's span) and **synchronizes**: it discards tokens until a reliable recovery
point — the start of the next top-level declaration keyword (`primitive` / `enum`
/ `concept` / `namespace` / an instance head), a closing `}`, or a `;` — then
resumes. The result is a best-effort partial AST plus every syntax diagnostic
found. A dedicated `synchronize()` method centralizes the token-skipping;
`expect()`-style helpers report-and-recover instead of `throw this.error(...)`.

**`load` — file-attributed, returns diagnostics:**

```ts
export interface LoadResult { model: Model; diagnostics: Diagnostic[] }
export function load(sources: SourceFile[]): LoadResult
```

It parses each `SourceFile` (accumulating syntax diagnostics with correct
`uri`s), then runs the existing two-pass build over the combined declarations,
producing a Model even when some declarations failed to parse. (Breaking change
from `load(string[]): Model` — acceptable: TODL is unpublished, and the loader is
`parse()`'s only caller.)

**`check` — the one call Plexus makes:**

```ts
export function check(sources: SourceFile[]): { model: Model; diagnostics: Diagnostic[] }
```

`check` = `load` then `validate(model)`, concatenating parse + semantic
diagnostics, every one spanned. Plexus groups the result by `span.uri` to place
Monaco markers per open file and to populate a Problems panel.

### 4. Publish

Bump `@pragmatic-tech-ai/todl` (0.0.1 → 0.1.0, minor: additive API + intended
breaking `load` signature pre-1.0), build, and `npm publish` to Verdaccio
(`http://localhost:4873`) — the same registry Plexus already consumes mural and
fresco from.

## Affected surface

- `src/parse/lexer.ts` — span helper (and optional end fields).
- `src/parse/ast.ts` — `span` on every node type.
- `src/parse/parser.ts` — thread `uri`, stamp spans, replace throw-on-error with
  record-and-`synchronize()`, return `ParseResult`.
- `src/parse/loader.ts` — `SourceFile[]` input, per-file parse, record node spans
  on the Model, return `LoadResult`.
- `src/model/model.ts` — `spanOf(id)` + the span map populated by the loader.
- `src/validate/validate.ts` — `span` on `Diagnostic`, `syntax.*` codes, span
  enrichment; add `check()` (here or a small `src/api.ts`).
- `src/index.ts` — export `Position`, `SourceSpan`, `SourceFile`, `ParseResult`,
  `LoadResult`, `check`; updated `parse`/`load` signatures.
- `package.json` — version bump.
- Test fixtures + any in-repo callers of `parse`/`load` updated to the new
  signatures.

## Testing

- **Span accuracy (parse):** each fixture's parsed nodes assert exact
  start/end line:column against known positions; a raw-string (`"""`) node
  asserts a multi-line end.
- **Recovery:** a source with several distinct syntax errors yields one
  diagnostic per error (not one-then-stop), each with the right span, and a
  partial Model that still contains the well-formed declarations around them.
- **Semantic span mapping:** a failed invariant / target-type mismatch /
  cardinality violation resolves to the offending instance's (or member's) span,
  including the correct `uri` when the error's declaration and its referent live
  in different `SourceFile`s.
- **`check` end-to-end:** mixed syntax + semantic errors across two
  `SourceFile`s come back as one spanned `Diagnostic[]`, correctly partitioned by
  `uri`.

## Out of scope (follow-on)

**Sub-project 2 — Plexus meta-model project type** (separate spec): a
`MetaModelProjectFactory` (`IProjectFactory`) with manifest `type:
"meta-model"` (+ id/version), whose `.todl` files open in the Monaco editor; a
service runs `check()` over the project (debounced on edit) and pushes spanned
diagnostics as Monaco markers per file + into a Problems panel. Growing the
`architecture-meta-models` panel into a reflective schema browser is explicitly
later still.

Not in this sub-project: cross-meta-model dependency resolution / package
manager (`.todl-deps/`, `todl.lock`), the `toTodl()` round-trip serializer, and
any viz round-trip.

## Open decisions

- Store end position on `Token` vs. compute via a `tokenSpan` helper — settle
  during implementation; the helper is the default (no data-model change).
- `check()`'s home: extend `validate.ts` or a new thin `src/api.ts`. Minor;
  recommend a small `src/api.ts` so `validate.ts` stays pure semantic logic.
