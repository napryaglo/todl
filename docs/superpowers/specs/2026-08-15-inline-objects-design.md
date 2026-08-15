# Inline object construction — design

**Date:** 2026-08-15
**Status:** Approved (brainstorming)
**Repo:** TODL (`@pragmatic-lab/todl`)

## Motivation

TODL values today are only string, name/reference, list, `|`-composite, and
boolean. A concept-typed field (e.g. `component.slots : slot[]`) can only be
populated by authoring a **named nested record** (`slot s1 { … }`) whose
concept happens to match a parent field's type. That forces an author to
invent an id for every sub-object and relies on concept→field type matching
(ambiguous when two fields share a type).

Inline object construction lets a field be assigned a **typed anonymous
object literal** — `field = concept { … }` and lists thereof — bound
directly to the named field. Each inline object is materialised as a real,
addressable node (visible through `toElement`/`Element` and selectable in
Plexus), with a stable id assigned by an injectable **id generator**
(snowflake-like by default).

This is item #2's first half; **operator definitions** are a separate,
later spec.

## Non-goals

- Operator definitions (`~>`/`==>` etc.) — separate spec.
- Untyped/inferred object literals (`field = { … }` with no concept keyword)
  — rejected in brainstorming; the concept is always explicit.
- Unifying the existing parse-time synthetic-id minting (`edgeSeq` for edge
  records, orphan ids) onto the id-generator seam — noted fast-follow, out
  of scope here to keep the change tight.

## 1. IdGenerator abstraction

A seam for minting node ids, injected at **load** time (so the parser stays
pure and deterministic):

```ts
// src/model/id-generator.ts
export interface IdGenerator {
  next(): string;
}

// Default production impl: time + monotonic sequence, sortable, unique.
// Rendered identifier-safe (leading letter) so an id is a legal node id.
export class SnowflakeIdGenerator implements IdGenerator {
  next(): string { /* e.g. `o` + base36(timestamp) + base36(seq) */ }
}
```

- `load(sources, opts?)` gains an optional `idGenerator` (default
  `new SnowflakeIdGenerator()`), threaded to the instance-application pass.
  `check` forwards it.
- **Testability:** a `FakeIdGenerator` (deterministic `id-0, id-1, …`) is
  injected by tests so loads are reproducible. Production is snowflake.
- Snowflake ids are **not reproducible across loads**, so a fresh inline
  object's id is only stable once **persisted** (§6). Determinism in tests
  comes from the injected fake, not from the generator.

## 2. Grammar & AST

A new value form — a **typed inline object** — usable anywhere a value is
(single value and list item):

```todl
component c1 {
  slots = [
    slot { environment = prod; },               // fresh → id minted at load
    slot { id = o7f3a9c1; environment = dev; }  // persisted → loader reuses id
  ];
  primary = slot { environment = prod; };      // single-valued field
}
```

AST (`src/parse/ast.ts`):

```ts
export enum ValueKind { String, Name, List, Composite, Boolean, Object }

export interface ObjectValue {
  kind: ValueKind.Object;
  concept: string;                 // explicit concept (may be ns-dotted)
  assignments: AssignmentNode[];   // full record body — includes an optional `id = …`
  children: InstanceDecl[];        // nested named records / edge records
  annotations: AnnotationApplication[];
  conceptSpan?: SourceSpan;
  span: SourceSpan;
}
export type ValueNode = StringValue | NameValue | ListValue | CompositeValue | BooleanValue | ObjectValue;
```

- The id, when present, is an ordinary `id = <value>;` **assignment** in the
  body (not a positional slot). Absent → the loader mints one.
- The body reuses the full record grammar, so inline objects nest inline
  objects, named records, and edge records. **v1 deferral:** an `annotate`
  *inside* an inline object parses but is **not staged** by the loader in v1
  (inline nodes are synthesized after the source-unit annotation pass) — a
  noted follow-up; annotations on the owning record are unaffected.

## 3. Parser

`parseValue` (`src/parse/parser.ts:446`) gains one branch: when the current
token is an `Identifier` (optionally dotted) **immediately followed by `{`**,
parse a typed inline object — read the concept path, then run the existing
record-body loop (the same loop `parseInstanceFrom` uses at lines 215-235:
`annotate`, `connectors`, `name = value`, edge records, nested records) and
return an `ObjectValue`. Otherwise the identifier is a name/reference/boolean
value exactly as today.

- Disambiguation is a pure lookahead: `Identifier {` (or `ns.Concept {`) →
  object; anything else → the existing value paths. No id generation in the
  parser.
- The record-body loop is extracted into a shared helper
  (`parseRecordBody`) so `parseInstanceFrom` and inline-object parsing use
  one implementation.

## 4. Loader / materialisation

A new `realizeValue` case (`src/parse/loader.ts:835`) for `ObjectValue`,
applied for a single value and once per list item:

- `id = obj.assignments.find(a => a.name === "id")?.value` (as a string) **or**
  `idGen.next()`.
- `builder.assertInstance(obj.concept, id)`, `setField(id, "id", id)`.
- `builder.addContains(owner, id)` and `builder.addRelationship(owner,
  fieldName, id)` — bound to the **explicitly named** field (the assignment's
  LHS), so there is none of `bindToField`'s concept-matching ambiguity.
- Realise the remaining assignments (all except the consumed `id`) and the
  children by recursing the instance machinery (`applyInstance`) so nested
  inline objects / records work.
- List value → each item materialised and bound to the same (multi-valued)
  field, preserving order.

The id generator is threaded from `load` down to `realizeValue` (via the
applications/instance pass and `applyInstance`). Every inline object becomes
a first-class node — addressable by `toElement`/`Element` and Plexus.

## 5. Validation

- The field named on the LHS must be **concept- or taxonomy-typed**.
  Assigning an inline object to a primitive-typed field (or to no such field)
  is a diagnostic `DiagnosticCode.InlineObjectTarget`.
- `obj.concept` must be the field's declared type **or a subtype**
  (`model.supertypesOf`). A mismatch is `DiagnosticCode.InlineObjectType`.
- Both carry the object's span. Existing member/annotation validation applies
  to the object's own body unchanged.

## 6. Round-trip / persistence

Because snowflake ids are not reproducible, an inline object's identity is
stable only once written back. The `.todl` emitter (`src/emit/todl.ts`)
therefore emits a **field-bound contained child as an inline object value**,
with its id materialised as an `id = <id>;` assignment:

```todl
slots = slot { id = o7f3a9c1; environment = dev; };
```

- Emission rule (no marker attr needed): a contained node that is the target
  of exactly one field-named relationship from its container is emitted as an
  inline object on that field; a contained node with no field binding stays a
  named nested record.
- **Consequence (disclosed):** a *named* nested record that binds to a field
  (today's `slot s1 { … }` form) also normalises to inline form on emit
  (`slots = slot { id = s1; … };`). No information is lost — the name becomes
  the `id` assignment — but it is a canonicalisation of the two authoring
  forms into one. This is intended.
- A round-trip is therefore lossless and **stable**: id-less source → mint at
  load → emit `id = <minted>;` → reload reuses that id (§4).

## 7. Testing

- **Parser:** single inline object, list of them, nested inline objects,
  with and without an `id =` assignment; `Identifier {` disambiguation from a
  bare name value.
- **IdGenerator:** `SnowflakeIdGenerator.next()` is unique + monotonically
  increasing + identifier-safe; `FakeIdGenerator` is deterministic.
- **Loader:** minted-id path (fake generator → `id-0`), persisted-id path
  (author `id =` reused), containment + explicit field binding present, list
  order + multi-binding, nested inline object materialised.
- **Validation:** inline object on a primitive field → `InlineObjectTarget`;
  wrong concept → `InlineObjectType`; correct subtype accepted.
- **Round-trip:** id-less inline object → load (fake gen) → emit shows
  `id = id-0;` → re-parse/re-load reuses `id-0` (stable); a named
  field-bound record normalises to inline form.

## Files changed

- `src/model/id-generator.ts` — `IdGenerator`, `SnowflakeIdGenerator` (new).
- `src/parse/ast.ts` — `ValueKind.Object`, `ObjectValue`.
- `src/parse/parser.ts` — `parseValue` inline-object branch; extract
  `parseRecordBody`.
- `src/parse/loader.ts` — thread `IdGenerator` from `load`; `realizeValue`
  `ObjectValue` case; validation.
- `src/api.ts` — `check` forwards the optional `IdGenerator`.
- `src/diagnostics/diagnostic.ts` — `InlineObjectTarget`, `InlineObjectType`.
- `src/emit/todl.ts` — emit field-bound children as inline objects.
- Tests under the matching `tests/` subfolders (incl. a `FakeIdGenerator`
  test double).

## Backward compatibility

- Purely additive grammar: no existing source uses `Identifier {` as a value,
  so nothing re-parses differently.
- `load`/`check` gain an **optional** id-generator arg (default snowflake);
  existing callers/tests are unaffected (no inline objects → no id minting).
- Emit normalises field-bound nested records to inline form (§6) — the only
  behavioural change to existing output, and lossless.
