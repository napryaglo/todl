# SP1 — Union Relationship Targets — Design

**Date:** 2026-08-11
**Branch:** `feat/union-relationship-targets` (off TODL `main` @ 4499443)
**Program:** reference-integrity fix, sub-project 1 of 5 (SP1 language → SP2 meta-model retype → SP3 data migration/emit → SP4 edge-record round-trip → SP5 Plexus drop factory).

## Goal

Let a `concept` relationship declare a **union** of target concepts —
`relationship from -> actor | block | location | component | application?;` —
so semantically-referential fields that legally point at several concept types
can be declared as real relationships (symbol-checked) instead of the
`identifier` primitive (unchecked). This is the missing language capability that
forced the tech-architecture meta-model to type `connector.from/to`,
`step.src/dst`, etc. as `identifier` (see [[todl-reference-integrity]]).

## Why this is the right fix

The compiler already enforces reference integrity for reference members
(quoted-string → error, bare name → resolved-or-`reference.undefined`), and
`checkTargetTypes` already builds an **allowed set** with is-a
(`allowed = {target} ∪ subtypesOf(target)`). Union targets are a natural
extension: seed the allowed set from several concepts. No shared supertype
exists among the endpoint concepts, so a union target is the exact-typing option.

## Surface syntax

```
relationship <name> -> <concept> [ | <concept> ]* <cardinality>;
```

- `<cardinality>` (`?` / `[]` / `[+]` / none) applies to the whole relationship,
  after the last target.
- A single target (`-> location`) is the length-1 case — same syntax as today.
- The `Pipe` token (`|`) already exists in the lexer
  ([lexer.ts:31](../../../src/parse/lexer.ts#L31)).

**Match semantics (decided): match-ANY.** An instance edge's target must be an
instance of **one** of the union members (or a subtype of one). The mismatch
message lists every allowed target.

## Model: `target` becomes `targets` everywhere

Clean, plural cutover — no field carries a single target after this change.

| Layer | File | Change |
|---|---|---|
| AST | [ast.ts:157](../../../src/parse/ast.ts#L157) | `RelationshipDecl.target: string` → `targets: string[]`; `targetSpan?` → `targetSpans?: SourceSpan[]` |
| Parser | [parser.ts:713](../../../src/parse/parser.ts#L713) | after first `parseDottedPath()`, `while (match(Pipe)) targets.push(parseDottedPath())`; collect spans in parallel; ≥1 target required |
| Loader | [loader.ts:418](../../../src/parse/loader.ts#L418) | pass `targets` array to `addConceptRelationship` |
| EdgeKind | `src/model/graph.ts` (EdgeKind enum) | add `Targets` — an ontology-tier edge from a relationship-schema node to a target concept node |
| Builder | [builder.ts:154](../../../src/model/builder.ts#L154) | `addConceptRelationship(concept, name, targets: NodeId[], …)`: stage one `Targets` **edge** per target (`memberId --Targets--> targetᵢ`) in insertion order; **remove** the `"target"` scalar attr. `TermInput.relationships[].target` → `targets` ([builder.ts:28](../../../src/model/builder.ts#L28)) |
| Schema | [model.ts:37](../../../src/model/model.ts#L37) | `RelationshipSchema.target: NodeId` → `targets: NodeId[]` |
| effectiveSchema | [model.ts:330](../../../src/model/model.ts#L330) | read targets via `graph.related(memberId, EdgeKind.Targets, Direction.Out)` (insertion order) into `targets`; **no** `"target"` attr read |
| Validation | [validate.ts:436](../../../src/validate/validate.ts#L436) | `allowed = ⋃ᵢ ({targetsᵢ} ∪ subtypesOf(targetsᵢ))`; skip when `targets` empty; message: `expects one of <a | b | c>` |
| References | [references.ts:96](../../../src/parse/references.ts#L96) | visit each target with its own span; `rewrite` patches `targets[i]` (AST-level, unchanged by the storage move) |
| JS emit | [js-module.ts:121](../../../src/emit/js-module.ts#L121) | `target: <str>` → `targets: <array>` (reads `RelationshipSchema.targets`) |
| Hover | [hover.ts:24](../../../src/language-service/hover.ts#L24) | `${r.targets.join(" \| ")}` |
| schema-context | [schema-context.ts:33](../../../src/language-service/schema-context.ts#L33) | `targetConcept: string` → `targetConcepts: string[]` |
| signature-help | [signature-help.ts:14](../../../src/language-service/signature-help.ts#L14) | display `targetConcepts.join(" \| ")` |
| Completion | uses schema-context | offer terms of **all** target concepts |

No change: document-symbols (keyed by name), `migrate/recase.ts` (target
recasing is type-based already).

### Storage: targets are graph edges, not a string attr (decided)

The relationship-schema node no longer carries a `target` scalar attr. Each
target concept is a first-class `Targets` **edge** from the relationship node
(`component.in`) to the concept node (`location`). Rationale: targets are
concept **references**, so they belong in the graph as edges — queryable,
individually resolvable, order-preserving — not packed into a delimited string.
A single target is just one `Targets` edge, so this also removes the stringly-
typed `target` attr from the existing single-target case (uniform).

- Symbol-checking of each target still happens at load via `references.ts`
  (`RelationshipTarget` role) — an undefined target is `reference.undefined`.
  The `Targets` edges are the post-resolution graph form of ids already proven
  valid.
- **Order:** `Targets` edges are staged in author order and `graph.related`
  returns adjacency in insertion order, so `targets`, emit, and `a | b | c`
  display are deterministic. A test asserts this.
- **JSON round-trip** (`emit/json.ts`): edges serialize as-is, so the new
  `Targets` edges carry through the graph JSON — but the relationship JSON shape
  changes from an attr to edges (see migration).

## Migration & compatibility (decided: explicit, hard cutover)

No back-compat shims — the reader (`effectiveSchema`) reads only `Targets`
edges; `js-module` emits only `targets`; there is no dual-representation
aliasing and no fallback to the old `target` attr.

- **Source `.todl` (single targets):** unaffected — `-> location` still parses
  (length-1 union) and emits identically. No source rewrite needed.
- **Persisted graph JSON (breaking):** a relationship's target moves from a
  `target` string attr to `Targets` edges. Every published package whose graph
  JSON encodes relationship schemas (meta-models; libraries that declare
  relationships) must be **rebuilt/republished** with the new emitter — the old
  attr form is not read. This is the explicit migration; it is executed per
  package, not papered over with a compatibility read.
- **Published JS (breaking):** `relationshipEntries` emits `targets: [...]`;
  consumers reading `.target` on a published schema break and are updated to
  `.targets`.
- **Explicit migration checklist (executed in SP2/SP5, enumerated here):**
  republish tech-architecture (SP2) and every first-party library/meta-model
  carrying relationships; update Plexus schema consumers (`deriveClasses` and
  any relationship `.target` reader) to `.targets` (SP5). No consumer or
  persisted artifact is left on the old representation.

**Downstream consumers to migrate (explicit checklist, tracked into SP2/SP5):**
- TODL `emit/js-module.ts` output shape → `targets` (SP1).
- Any TODL internal reader of `RelationshipSchema.target` → `.targets` (SP1).
- Plexus meta-model schema consumers reading a relationship `.target` (SP5) —
  audit `deriveClasses` and typed-client code.
- Republish tech-architecture + any library whose emitted JS declares
  relationships (SP2).

## Testing

- **Parser:** `relationship r -> a | b | c[];` → `targets == ["a","b","c"]`,
  cardinality `Many`, three `targetSpans`. Single target → `["a"]`.
- **Validation (match-any):** a concept with `relationship from -> a | b`;
  an instance `from = <a-instance>` and `from = <b-instance>` both pass; a
  `from = <c-instance>` yields one `TargetTypeMismatch` naming `a | b`. Subtype
  of `a` passes (is-a preserved).
- **Reference integrity still holds:** `from = "quoted"` on the union
  relationship → `MemberValueKind` error ("expected a name, not a quoted
  string"); `from = undefined_id` → `reference.undefined`.
- **Storage (edges):** a concept with `relationship from -> a | b | c` produces
  three `Targets` edges from `<concept>.from`; `effectiveSchema().targets` is
  `["a","b","c"]` in author order; a single-target relationship yields exactly
  one `Targets` edge and no `target` attr. Order survives a graph JSON round-trip.
- **js-module emit:** a union relationship emits `targets: ["a","b"]`.
- **Language service:** hover/signature render `a | b`; completion on the union
  member offers terms of both target concepts.
- Update the existing target-asserting tests (parser, ast-reference-spans,
  target-type, schema-context, model/schema) to the plural shape.

## Out of scope (later sub-projects)

- Retyping the tech-architecture endpoint fields (SP2).
- Migrating `.todl` data from quoted-string refs to bare (SP3).
- Edge-record `#`-id + shorthand emission (SP4).
- Plexus drop factory `label` + bare refs + `.target`→`.targets` consumer
  updates (SP5).

## Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real enums, no string-literal unions.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run `tsx --conditions=development --test "src/**/*.test.ts"` (full suite) at the end; no push unless asked.
- Publishing a new TODL version + republishing consumers is an SP2+ decision, surfaced to the user.
