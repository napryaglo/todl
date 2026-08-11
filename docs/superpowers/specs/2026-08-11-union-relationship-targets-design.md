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
| Builder | [builder.ts:154](../../../src/model/builder.ts#L154) | `addConceptRelationship(concept, name, targets: NodeId[], …)`; store the `"target"` attr as `targets.join(",")` (concept ids are `[a-z_]+`, comma-free). `TermInput.relationships[].target` → `targets` ([builder.ts:28](../../../src/model/builder.ts#L28)) |
| Schema | [model.ts:37](../../../src/model/model.ts#L37) | `RelationshipSchema.target: NodeId` → `targets: NodeId[]` |
| effectiveSchema | [model.ts:330](../../../src/model/model.ts#L330) | read `"target"` attr and `.split(",")` into `targets` (a lone `"location"` → `["location"]`) |
| Validation | [validate.ts:436](../../../src/validate/validate.ts#L436) | `allowed = ⋃ᵢ ({targetsᵢ} ∪ subtypesOf(targetsᵢ))`; skip when `targets` empty; message: `expects one of <a | b | c>` |
| References | [references.ts:96](../../../src/parse/references.ts#L96) | visit each target with its own span; `rewrite` patches `targets[i]` |
| JS emit | [js-module.ts:121](../../../src/emit/js-module.ts#L121) | `target: <str>` → `targets: <array>` |
| Hover | [hover.ts:24](../../../src/language-service/hover.ts#L24) | `${r.targets.join(" \| ")}` |
| schema-context | [schema-context.ts:33](../../../src/language-service/schema-context.ts#L33) | `targetConcept: string` → `targetConcepts: string[]` |
| signature-help | [signature-help.ts:14](../../../src/language-service/signature-help.ts#L14) | display `targetConcepts.join(" \| ")` |
| Completion | uses schema-context | offer terms of **all** target concepts |

No change: JSON graph round-trip (`emit/json.ts` carries the `"target"` attr
verbatim), document-symbols (keyed by name), `migrate/recase.ts` (target recasing
is type-based already).

## Migration & compatibility (decided: explicit, hard cutover)

No back-compat shims — the reader accepts only the plural shape; `js-module`
emits only `targets`; there is no dual-field aliasing.

- **Source `.todl` (single targets):** unaffected — `-> location` still parses
  (length-1 union). No source rewrite needed.
- **Graph attr storage:** a single target stored as `"location"` reads back as
  `["location"]`, so existing in-memory/JSON graphs with single targets are not
  broken — this is representation-compatible, not a shim.
- **Published meta-model / library JS (breaking):** `relationshipEntries` now
  emits `targets: [...]`. Any consumer reading `.target` on a published schema
  breaks. **Explicit migration:** every first-party package built with the old
  emitter is republished so its JS carries `targets`, and Plexus schema
  consumers (`deriveClasses` and anything reading a relationship `.target`) are
  updated to `.targets`. SP1 owns the TODL emit change; the republish +
  consumer update is enumerated here and executed in **SP2** (meta-model retype
  republishes tech-architecture) and **SP5** (Plexus). No consumer is left
  reading `.target`.

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
