# TODL Author-Defined Operators — Design

**Date:** 2026-08-16
**Status:** Approved (brainstorm)
**Scope:** The TODL language engine (lexer, parser, loader, validation, emit). The
tech-architecture meta-model migration is a documented follow-up, not part of this spec.

## Motivation

Edges are authored today through a hardcoded shorthand: `<concept> a -> b` (or
`a --> b`), where the parser maps endpoints to fields by concept name —
`step` → `src`/`dst`, everything else → `from`/`to` — and the arrow glyph itself
is consumed and **discarded** (the choice between `->` and `-->` means nothing).
The `connectors { … }` block is a second hardcoded path bound to `connector`.

This has three problems the feature addresses together:

1. **Authoring ergonomics.** Humans and agents should write terse `a ~> b`
   instead of `connector c1 { from = a; to = b; }`, with the meta-model declaring
   the glyphs.
2. **Generalize hardcoded edges.** The `step→src/dst, else→from/to` special-casing
   and the `connectors {}` block are removed from the parser and replaced by a
   meta-model-declared mechanism.
3. **Round-trip for the viz.** Edits materialized in the graph re-serialize to
   terse operator form, losslessly.

Native edge syntax is currently **unused** in the corpus (everything is flattened
verbose records), so there is no backward-compatibility burden and the built-in
shorthand is removed rather than preserved.

## Overview

An author declares infix binary **operators** in a meta-model. Each operator binds
a glyph (e.g. `~>`, `==>`, `->>`) to one of two targets:

- a **reified edge concept** plus two endpoint members, or
- a **relationship member** on a source concept.

In a model, `a <glyph> b` is parsed as a shape-only `EdgeApplication` and resolved
by the loader against the operators declared in the model's meta-model bases —
exactly as symbol references resolve. An undeclared glyph is an `operator.undefined`
diagnostic, not a lex or parse error.

## Section 1 — Operator declarations

A new top-level declaration, `DeclKind.Operator`, resolved against bases like
concepts and annotations.

```todl
// Reified-edge form: glyph mints an instance of <concept>, binding two endpoint members.
operator ~>  : connector (from, to);
operator ==> : step (src, dst);

// Relationship-member form: glyph adds one edge on <concept>.<relationship>, no node minted.
operator ->> : component.depends_on;
```

**Reified form:** `operator <glyph> : <concept> ( <fromMember> , <toMember> ) ;`
Endpoints are named explicitly — a `connector` has `from`, `to`, *and* `scenario`,
so inference is not viable.

**Relationship form:** `operator <glyph> : <concept> . <relationship> ;`
The source concept owns the relationship; the left operand must be that concept (or
a subtype), the right operand is the target.

Glyph identity is the token text. Operators are not namespace-qualified (a dotted
glyph is meaningless); they resolve globally within a model's base closure.

### AST

```ts
enum DeclKind { /* … */ Operator }

// Reified vs relationship distinguished by which fields are populated.
interface OperatorDecl {
  kind: DeclKind.Operator;
  glyph: string;              // e.g. "~>"
  glyphSpan?: SourceSpan;
  concept: string;            // target concept (both forms)
  conceptSpan?: SourceSpan;
  // Reified form:
  fromMember: string | null;  // null ⇒ relationship form
  toMember: string | null;
  // Relationship form:
  relationship: string | null; // null ⇒ reified form
  span: SourceSpan;
}
```

## Section 2 — Lexing & resolution timing

Custom glyphs cannot be a fixed token list. The lexer emits a generic
`TokenKind.SymbolOp` token by **maximal munch** over the edge-character set:

```
- ~ = > < !
```

This yields `->`, `-->`, `~>`, `==>`, `<->`, `->>`, `!>`, `<-`, `~~>`, etc. A lone
`=` still lexes as `TokenKind.Equals` (assignment); any longer run beginning with
`=` (e.g. `==`, `==>`) is a `SymbolOp`. The dedicated `Arrow` / `DoubleArrow`
tokens are removed and folded into `SymbolOp`; `->` becomes `SymbolOp("->")`.

The tokens `EqEq` / `NotEq` (`==`, `!=`) are subsumed by `SymbolOp` via the same
munch; `&&`, `||`, `|`, `&`, `!` (`Bang`) are unaffected because `&` and `|` are not
in the edge set. (`!` is in the edge set: a lone `!` now lexes as `SymbolOp("!")`
rather than `Bang`. `Bang`, `EqEq`, `NotEq`, `And`, `Or` are unused in the current
grammar, so removing/subsuming them is safe.)

**Resolution timing:** an unknown glyph is a valid lexical token and a valid parse
shape. Which concept/relationship a glyph maps to is resolved in the **loader**,
against the operator table assembled from the bases. An undeclared glyph →
`operator.undefined` (parallel to `reference.undefined`). Parse produces shape; the
loader resolves symbols — TODL's existing split is preserved.

## Section 3 — Usage & parse shape

`a <glyph> b`, with an optional attribute body or a terminator, parseable wherever
edge records parse today: top level, `model` body, and instance body.

```todl
agent ~> orchestrator;
agent ~> orchestrator { type = sync; };   // body → extra members (reified form only)
web ->> db;
```

The parser produces a dedicated shape-only node — it knows nothing about endpoint
fields or concepts:

```ts
interface EdgeApplication {
  kind: DeclKind.Edge;
  glyph: string;
  left: string;               // possibly dotted ref
  right: string;
  leftSpan?: SourceSpan;
  rightSpan?: SourceSpan;
  glyphSpan?: SourceSpan;
  body: AssignmentNode[];     // empty when written with `;`
  span: SourceSpan;
}
```

`edgeApplicationAhead()` replaces `edgeRecordAhead()`: `Identifier ( . Identifier )*`
immediately followed by a `SymbolOp`. Assignment (`name = value`) is still tried
first in `parseRecordBody`, so a lone `=` never reaches this path.

The hardcoded `connectors { … }` block and `parseApplicationConnectors` are removed
— once the glyph implies the concept, the block wrapper is redundant, and it is
unused in the corpus.

## Section 4 — Loader materialization

The loader builds an operator table (glyph → resolved `OperatorDecl`) from the
bases, then materializes each `EdgeApplication` by form.

**Reified form** — mints a real, addressable node, reusing the **IdGenerator seam**
introduced for inline objects:

- id from a body `id = …;` assignment if present, else `idGen.next()`;
- creates a `<concept>` instance;
- binds `fromMember → left` and `toMember → right` as reference edges, routed
  through the same endpoint reference-resolution as written-out members (so union
  targets, `reference.undefined`, and quoted-string-on-reference errors all apply);
- remaining body assignments become members on the node;
- the node is `Contains`-ed by the enclosing owner (the `model`, or the parent
  instance), exactly as inline objects are.

**Relationship form** — no node minted:

- resolve `left` (must be the source concept or a subtype — else an error);
- add a single `<relationship>` edge `left → right`;
- a non-empty body is an error (nothing to attach it to).

## Section 5 — Validation

**Declaration-time:**
- glyph well-formed: every character is in the edge set, and the glyph is not a lone
  `=` (reserved for assignment);
- target concept exists;
- reified form: both named members exist on the concept and are reference members;
- relationship form: the named member exists on the concept and is a relationship;
- duplicate glyph within one base closure → `operator.redeclared`.

**Usage-time:**
- unknown glyph → `operator.undefined`;
- relationship-form left operand not of the source concept (or subtype) → error;
- endpoint type mismatches delegate to the existing reference validation.

New diagnostic codes: `operator.undefined`, `operator.redeclared`,
`operator.malformed-glyph`, `operator.bad-endpoint` (member missing / not a
reference member / not a relationship), `operator.body-on-relationship`,
`operator.source-type`.

## Section 6 — Emit / round-trip

The emitter derives a reverse map from the loaded operators: concept → operator (for
reified edges) and `concept.relationship` → operator (for relationship edges).

- A reified-edge instance whose bound reference members are exactly some operator's
  `(fromMember, toMember)` re-emits as `left <glyph> right [ { …rest } ];`, where
  `…rest` is every member other than the two endpoints (and `id`, when minted).
- A relationship-form edge re-emits as `left <glyph> right;`.
- **Determinism:** when several operators map to one concept, choose the
  **first declared in base order**.
- Anything that does not match an operator falls back to the verbose record form, so
  **emit is always lossless; shorthand is best-effort**.

## Section 7 — Removals, scope, non-goals

**Removed:** `parseEdgeRecord`'s concept-based field mapping, `consumeEdgeOperator`,
the `Arrow` / `DoubleArrow` dedicated tokens, the `connectors { … }` block and
`parseApplicationConnectors`. Existing tests referencing `-->` / `connectors` are
migrated to declared operators.

**Non-goals (v1):**
- bidirectional / undirected operators — endpoints are ordered left→right;
- prefix / postfix / n-ary operators — infix binary only;
- operator precedence or chaining — `a ~> b ~> c` is not a chain;
- qualified / namespaced glyphs.

**Follow-up (separate, not in this spec):** the tech-architecture meta-model gains
`operator --> : connector (from, to)` and `operator ==> : step (src, dst)` (plus any
relationship-form operators desired), and is republished. Kept out of the engine
spec so this plan stays language-focused, matching the inline-objects split.

## Testing

- **Lexer:** maximal-munch of the edge set; lone `=` stays `Equals`; `->`/`==>`/`~>`
  tokenize as `SymbolOp`; a lone `!` is `SymbolOp`.
- **Parser:** `a ~> b;`, `a ~> b { … };`, dotted operands, `EdgeApplication` shape;
  assignment still wins over edge for `name = value`; unknown glyph parses cleanly.
- **Operator decl parse:** both forms into `OperatorDecl`.
- **Loader:** reified form mints a contained, endpoint-bound node (minted + explicit
  id); relationship form adds an edge with no node; union endpoint enforcement;
  `operator.undefined` on unknown glyph.
- **Validation:** each declaration-time and usage-time diagnostic above.
- **Round-trip:** reified and relationship edges emit as shorthand and re-parse to an
  equal graph; non-operator instance falls back to verbose; determinism with two
  operators on one concept.

Tests live in `tests/` subfolders next to their sources. TODL tests run with
`--test-force-exit`.
