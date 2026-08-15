# TODL Operator Value Expressions — Design

**Date:** 2026-08-16
**Status:** Approved (brainstorm)
**Scope:** The TODL language engine (parser, loader, validation, emit). Builds directly on the
author-defined operators feature (`docs/superpowers/specs/2026-08-16-operators-design.md`).

## Motivation

Author-defined operators today are **statements**: `a --> b;` appears in a record or model body
and the minted entity is contained by the enclosing owner. This works for standalone edges like
connectors, but it cannot populate a named field. A `sequence`'s ordered `steps : step[]` field is
read by consumers (diagram, scenario playback); an operator statement inside a sequence body mints a
contained step but leaves `sequence.steps` empty — the sequence renders as empty. So steps must be
authored as inline objects (`steps = [ step { src = a; dst = b; }, … ]`), and the `==>` operator
cannot be used for them.

The fix is to make an operator application an **expression** that evaluates to the minted entity's
reference, so it is usable wherever a value is — the RHS of `=` and array elements:

```todl
steps = [ a ==> b, b ==> c ];   // each ==> mints a step AND binds it, in order, to `steps`
```

An operator becomes a terser inline object: `a ==> b` ≡ `step { src = a; dst = b; }`.

## Overview

An operator application is an expression yielding the minted entity's reference, legal in two
positions:

- **Statement position** (record/model body): `a --> b;` — entity contained by the owner, reference
  discarded. Unchanged from today (connectors).
- **Value position** (RHS of `=`, array element): `x = a ==> b;` / `steps = [ a ==> b ];` — entity
  contained by the owner **and** its reference is the value, bound (in order) to the field.

Only **reified** operators (mint a concept node) produce an entity, so only they work in value
position. **Relationship-form** operators (add an edge, no node) have nothing to return and stay
statement-only; using one as a value is an error.

## Section 1 — The model

`a <glyph> b [ { … } ]` is an expression. Its value is a reference to the entity the operator mints.

- In statement position it is an expression-statement: the entity is contained by the enclosing
  record/model; the value is discarded. (Today's connector behavior — `a --> b;`.)
- In value position it is contained by the enclosing record **and** its reference is bound to the
  member (or list) it sits in, exactly like an inline object.

Equivalence: `a ==> b` ≡ `step { src = a; dst = b; }`; `a ==> b { kind = x }` ≡
`step { src = a; dst = b; kind = x; }`, where `src`/`dst` are the operator's declared endpoint
members.

Reified vs relationship form:
- **Reified** operator (`operator ~> : connector (from, to)`) mints a node → usable in both
  positions.
- **Relationship-form** operator (`operator ->> : component.depends_on`) adds a single edge and mints
  no node → statement-only. In value position it is an error (`operator.not-a-value`).

## Section 2 — Grammar & AST

Reuse the existing statement shape as a value. `EdgeApplication { glyph, left, right, body,
leftSpan?, rightSpan?, glyphSpan?, span }` is the single edge shape; it already backs the `.edges`
statement arrays.

- Add `ValueKind.Edge` and an `EdgeValue` value node that carries an `EdgeApplication` payload:

```ts
export interface EdgeValue {
  kind: ValueKind.Edge;
  edge: EdgeApplication;
}
```

- `EdgeValue` joins the `ValueNode` union.
- `parseValue` gains an edge branch at the top, before the name branch:

```ts
if (this.edgeApplicationAhead()) {
  return { kind: ValueKind.Edge, edge: this.parseEdgeApplication(this.startToken()) };
}
```

This covers RHS-of-`=` and array elements (list parsing calls `parseValue` per element). The
statement-vs-value split falls out of the existing lookahead: `a --> b` (next token after the dotted
name is a `SymbolOp`) → `edgeApplicationAhead()` true → statement, collected into `.edges`.
`x = a --> b` (next token after `x` is `=`) → false → assignment, and the edge is parsed by
`parseValue` on the RHS. No new ambiguity, and `parseEdgeApplication` is reused verbatim.

## Section 3 — Reference resolution

An edge value's operands are references, resolved like any value reference (qualified → flat,
undefined → `reference.undefined`). `references.ts` `visitValueRefs` gains a `ValueKind.Edge` case
that delegates to the existing `visitEdgeRefs(value.edge, visit, scope)` (already used for statement
edges), plus the body assignments' refs. The glyph resolves against the operator table in the loader
(`operator.undefined`), never through symbol resolution.

## Section 4 — Loader materialization & validation

`realizeValue` gains a `ValueKind.Edge` case that reuses the operator table and the reified-edge
materialization from the operators feature:

```ts
case ValueKind.Edge:
  realizeEdgeValue(builder, model, concept, id, name, value.edge, diagnostics, asserted, idGen, ops);
  break;
```

`realizeEdgeValue(builder, model, ownerConcept, owner, field, edge, diagnostics, asserted, idGen,
ops)`:

1. Resolve `edge.glyph` in `ops`. Unknown → `operator.undefined` (reuse `applyEdge`'s diagnostic).
2. If the operator is **relationship-form** (`relationship !== null`) → `operator.not-a-value`
   error (it yields no entity); stop.
3. **Field-type check** (same as `realizeInlineObject`): `referenceMemberType(model, ownerConcept,
   field)` must be defined, and the operator's `concept` must equal it or a subtype; else reuse
   `inline-object.target` / `inline-object.type`.
4. Mint the entity: id from a `{ id = … }` body assignment or `idGen.next()`; synthesize an
   `InstanceDecl` binding the operator's `from`/`to` endpoint members to `edge.left`/`edge.right`
   plus the remaining body, and apply it via `applyInstance` (reusing dedup/containment/reference
   resolution) with `owner` as the containing parent.
5. Bind the minted entity to the field: `builder.addRelationship(owner, field, mintedId)`.

This is the inline-object path with the operator supplying the concept and endpoint bindings. Steps
2–4 factor cleanly: `applyEdge` (statement) and `realizeEdgeValue` (value) share a helper that mints
the reified entity given `(owner, edge, op)` and returns its id; the value path additionally calls
`addRelationship(owner, field, id)` and runs the field-type check, while the statement path does not.

New diagnostic: `DiagnosticCode.OperatorNotAValue = "operator.not-a-value"`.

## Section 5 — Emit & round-trip

A field-bound reified edge currently emits as an inline object (`step { src=a; dst=b; }`) through the
inline-emit path. Extend value-position emit so that when a field-bound contained entity's concept
has a reified operator (via the existing `collectOperators` reverse map) and only its two endpoint
members are set, it emits `left <glyph> right` shorthand instead — with a body `{ …rest }` when other
attrs are present. Falls back to the inline-object form otherwise, so emit stays lossless and
shorthand is best-effort. This reuses `collectOperators` and the endpoint-detection logic already in
`emitOne`, lifted into the inline/value emit path (`emitInline`).

## Section 6 — Scope & non-goals

**In scope:** `ValueKind.Edge` parsing (RHS + array elements), reference resolution, loader
materialization with field binding + field-type check, relationship-form-as-value error, and
value-position shorthand emit.

**Non-goals (v1):**
- operands stay plain references — no nested `a ==> (b ==> c)`;
- no operator precedence or chaining;
- relationship-form operators remain statement-only (no invented return value);
- statement-position behavior is unchanged.

**Follow-up (separate, not this spec):** re-migrate the scenarios' steps from `step { … }` inline
objects to `a ==> b` value form now that they are expressible — a data change in
`test_architecture/landscape.todl`.

## Testing

- **Parser:** `x = a ==> b` parses as an assignment whose value is `ValueKind.Edge`; `[ a ==> b,
  c ==> d ]` parses as a list of edge values; `a --> b;` still parses as a statement edge; a name
  value (`x = foo`) is unaffected.
- **References:** an edge value's operands are visited as references; qualified operands rewrite flat.
- **Loader:** `steps = [ a ==> b ]` mints a step, contains it in the owner, and binds it to `steps`;
  an explicit `{ id = … }` is reused; a relationship-form operator in value position →
  `operator.not-a-value`; a concept mismatch → `inline-object.type`; an unknown glyph →
  `operator.undefined`.
- **Emit:** a field-bound reified edge round-trips as `a ==> b` shorthand and re-parses to an equal
  graph; a non-endpoint attr forces the `{ …rest }` body; a field-bound entity with no operator
  falls back to inline-object form.

Tests live in `tests/` subfolders next to their sources. TODL tests run with `--test-force-exit`.
