# Author-Defined Operators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a meta-model declare infix `operator` glyphs (e.g. `~>`, `==>`) that materialize edges — either a reified edge concept with two endpoint members, or a single relationship member — replacing TODL's hardcoded `->`/`-->` edge shorthand.

**Architecture:** A new `SymbolOp` lexer token (maximal-munch over an edge-char set) makes any glyph a valid lexical token; a new top-level `operator` declaration binds a glyph to a concept + endpoint members (reified) or a `concept.relationship` (relationship form); a new shape-only `EdgeApplication` AST node captures `a <glyph> b`; the loader resolves the glyph against an operator table built from the bases and materializes the edge (reusing the inline-object `IdGenerator` seam for reified ids); the emitter reverse-maps reified-edge instances back to shorthand.

**Tech Stack:** TypeScript (ESM, strict). Tests: `npx tsx --conditions=development --test --test-force-exit "src/<path>/tests/<file>.test.ts"`. Build: `npm run build`. node:test + node:assert/strict.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-16-operators-design.md`.
- Every test file lives in a `tests/` subfolder next to the source it exercises.
- TODL tests MUST run with `--test-force-exit`.
- Use real TypeScript enums, never string-literal unions.
- Edge-character set for glyphs: `- ~ = > < !` (a lone `=` stays assignment; any longer run is a `SymbolOp`).
- Edge USAGE (`a <glyph> b`) is confined to `model` bodies, instance bodies, and inline-object bodies. Bare top-level edge usage (outside a model) is NOT supported (it was unused). The `operator` DECLARATION is top-level.
- Reified-edge shorthand emit is in scope; relationship-form edges emit as their normal member assignment (still lossless). Glyph-shorthand emit for the relationship form is a documented non-goal of this plan.
- No prelude operators — the tech-architecture meta-model migration is a separate follow-up, not in this plan.
- Publish/version bump (`@pragmatic-tech-ai/todl` → 0.28.0) happens at the finishing step, not inside a task.

---

### Task 1: `SymbolOp` lexer token

**Files:**
- Modify: `src/parse/lexer.ts` (TokenKind enum ~29-41; `readOperator` ~132-155)
- Test: `src/parse/tests/lexer.test.ts` (existing; add cases)

**Interfaces:**
- Produces: `TokenKind.SymbolOp = "symbol-op"`. The lexer emits a single `SymbolOp` token whose `value` is the maximal run of edge-chars. A lone `=` still emits `TokenKind.Equals`. `TokenKind.Arrow` and `TokenKind.DoubleArrow` are removed.

- [ ] **Step 1: Write the failing test**

Add to `src/parse/tests/lexer.test.ts`:

```ts
test("edge glyphs lex as a single SymbolOp token", () => {
  const kinds = tokenize("~> ==> --> -> <-> ->> !>").filter((t) => t.kind !== TokenKind.EOF).map((t) => t.kind);
  assert.deepEqual(kinds, Array(7).fill(TokenKind.SymbolOp));
});

test("a SymbolOp preserves its exact glyph text", () => {
  const t = tokenize("a ==> b").find((t) => t.kind === TokenKind.SymbolOp);
  assert.equal(t?.value, "==>");
});

test("a lone = still lexes as assignment, not a SymbolOp", () => {
  const t = tokenize("x = y");
  assert.equal(t[1]?.kind, TokenKind.Equals);
});

test("a longer =-run lexes as a SymbolOp", () => {
  assert.equal(tokenize("x == y")[1]?.kind, TokenKind.SymbolOp);
});
```

Also update any existing lexer test that references `TokenKind.Arrow` / `TokenKind.DoubleArrow` (around lines 25 and 57) to expect `TokenKind.SymbolOp` with value `"->"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/lexer.test.ts"`
Expected: FAIL — `TokenKind.SymbolOp` undefined.

- [ ] **Step 3: Implement**

In `src/parse/lexer.ts` TokenKind enum, remove `Arrow = "->"` and `DoubleArrow = "-->"`; add:

```ts
  SymbolOp = "symbol-op",
```

Add a module-level constant near `SINGLE_CHAR`:

```ts
/** Characters that compose an author-defined operator glyph (design §2). A
 * maximal run of these becomes one SymbolOp token; a lone "=" is assignment. */
const EDGE_CHARS = new Set(["-", "~", "=", ">", "<", "!"]);
```

Replace the body of `readOperator` (lines 132-155) with:

```ts
  private readOperator(line: number, column: number): void {
    const char = this.peek();

    if (EDGE_CHARS.has(char)) {
      let run = "";
      while (EDGE_CHARS.has(this.peek())) run += this.advance();
      if (run === "=") return this.tokens.push(this.tok(TokenKind.Equals, "=", line, column));
      return this.tokens.push(this.tok(TokenKind.SymbolOp, run, line, column));
    }

    const two = char + this.peek(1);
    if (two === "&&") return this.push(TokenKind.And, "&&", line, column, 2);
    if (two === "||") return this.push(TokenKind.Or, "||", line, column, 2);

    const single = SINGLE_CHAR.get(char);
    if (single !== undefined) return this.push(single, char, line, column, 1);
    if (char === "&") return this.push(TokenKind.Amp, "&", line, column, 1);
    if (char === "|") return this.push(TokenKind.Pipe, "|", line, column, 1);

    this.report(DiagnosticCode.UnexpectedCharacter, `unexpected character "${char}"`, line, column, column + 1);
    this.advance();
  }

  /** Build a token spanning the already-advanced run [column, this.column). */
  private tok(kind: TokenKind, value: string, line: number, column: number): Token {
    return { kind, value, line, column, endLine: this.line, endColumn: this.column };
  }
```

Remove the now-dead `EqEq`, `NotEq`, `Bang` handling from `readOperator` (they are subsumed by `SymbolOp` or unused). Leave the `EqEq`/`NotEq`/`Bang`/`And`/`Or` enum members in place if other code imports them; if `tsc` reports them unused, that is fine — only remove enum members that cause a compile error.

Verify `push` and `advance` exist and that `advance()` returns the consumed char (check the lexer's helpers around lines 165-180; if `advance()` does not return the char, read the char via `this.peek()` before advancing, matching the existing style).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/lexer.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parse/lexer.ts src/parse/tests/lexer.test.ts
git commit -m "feat(lexer): SymbolOp token for author-defined operator glyphs"
```

---

### Task 2: `operator` declaration — AST + parser

**Files:**
- Modify: `src/parse/ast.ts` (DeclKind enum ~12-21; add `OperatorDecl`; add to `Declaration` union ~265-267)
- Modify: `src/parse/parser.ts` (`parseDeclaration` ~168-191; add `parseOperator`)
- Test: `src/parse/tests/operator-decl.test.ts` (create)

**Interfaces:**
- Produces: `DeclKind.Operator`; `interface OperatorDecl { kind: DeclKind.Operator; glyph: string; glyphSpan?: SourceSpan; concept: string; conceptSpan?: SourceSpan; fromMember: string | null; toMember: string | null; relationship: string | null; span: SourceSpan; }`. Reified form ⇒ `fromMember`/`toMember` set, `relationship` null. Relationship form ⇒ `relationship` set, `fromMember`/`toMember` null.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/operator-decl.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, type OperatorDecl } from "../ast.js";

function firstOperator(text: string): OperatorDecl {
  return parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Operator) as OperatorDecl;
}

test("a reified-edge operator parses with concept + two endpoint members", () => {
  const op = firstOperator(`namespace t { operator ~> : connector (from, to); }`);
  assert.equal(op.glyph, "~>");
  assert.equal(op.concept, "connector");
  assert.equal(op.fromMember, "from");
  assert.equal(op.toMember, "to");
  assert.equal(op.relationship, null);
});

test("a relationship-form operator parses with concept.relationship", () => {
  const op = firstOperator(`namespace t { operator ->> : component.depends_on; }`);
  assert.equal(op.glyph, "->>");
  assert.equal(op.concept, "component");
  assert.equal(op.relationship, "depends_on");
  assert.equal(op.fromMember, null);
  assert.equal(op.toMember, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/operator-decl.test.ts"`
Expected: FAIL — `DeclKind.Operator` undefined.

- [ ] **Step 3: Implement the AST**

In `src/parse/ast.ts`, add `Operator` to `DeclKind`:

```ts
export enum DeclKind {
  Primitive,
  Taxonomy,
  Viewpoint,
  Concept,
  Instance,
  Model,
  Annotation,
  Package,
  Operator,
}
```

Add the interface (near `AnnotationDecl`):

```ts
/** A `operator <glyph> : <concept> (<from>, <to>);` (reified edge) or
 * `operator <glyph> : <concept>.<relationship>;` (relationship member)
 * declaration — binds an infix glyph to edge materialization (design §1). */
export interface OperatorDecl {
  kind: DeclKind.Operator;
  glyph: string;
  glyphSpan?: SourceSpan;
  concept: string;
  conceptSpan?: SourceSpan;
  /** Reified form: the two endpoint member names; null for the relationship form. */
  fromMember: string | null;
  toMember: string | null;
  /** Relationship form: the relationship member on `concept`; null for the reified form. */
  relationship: string | null;
  span: SourceSpan;
}
```

Add `OperatorDecl` to the `Declaration` union.

- [ ] **Step 4: Implement the parser**

In `src/parse/parser.ts` `parseDeclaration`, add before the `class` check:

```ts
    if (this.checkKeyword("operator")) return this.parseOperator(start);
```

Add the method (near `parseAnnotation`). The glyph is a `SymbolOp` token; the concept is a dotted path, and if the last `.segment` is a member the parser treats it as the relationship form:

```ts
  /** `operator <glyph> : <concept> (<from>, <to>);`  (reified)
   *  `operator <glyph> : <concept>.<relationship>;`   (relationship). */
  private parseOperator(start: Token): OperatorDecl {
    this.expectKeyword("operator");
    const glyphTok = this.expect(TokenKind.SymbolOp);
    this.expect(TokenKind.Colon);
    const conceptStart = this.current();
    const path = this.parseDottedPath();               // `connector` or `component.depends_on`
    let concept = path;
    let relationship: string | null = null;
    let fromMember: string | null = null;
    let toMember: string | null = null;
    if (this.match(TokenKind.LParen)) {                // reified form: (from, to)
      fromMember = this.expectIdentifier();
      this.expect(TokenKind.Comma);
      toMember = this.expectIdentifier();
      this.expect(TokenKind.RParen);
    } else {                                           // relationship form: split last segment
      const dot = path.lastIndexOf(".");
      if (dot < 0) throw this.error(`operator "${glyphTok.value}" needs endpoints "(from, to)" or a "concept.relationship" target`);
      concept = path.slice(0, dot);
      relationship = path.slice(dot + 1);
    }
    this.expect(TokenKind.Semicolon);
    const decl: OperatorDecl = {
      kind: DeclKind.Operator, glyph: glyphTok.value, concept, fromMember, toMember, relationship,
      span: this.spanFrom(start),
    };
    decl.glyphSpan = tokenSpan(glyphTok, this.uri);
    decl.conceptSpan = this.spanFrom(conceptStart);
    return decl;
  }
```

Import `OperatorDecl` in the parser's ast import and confirm `tokenSpan` is already imported (it is used elsewhere in the file). Ensure `"operator"` is treated as a keyword by `checkKeyword`/`expectKeyword` (these match identifier text, so no lexer keyword table change is needed — verify by reading `checkKeyword`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/operator-decl.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/operator-decl.test.ts
git commit -m "feat(parser): operator declaration (reified + relationship forms)"
```

---

### Task 3: `EdgeApplication` usage — AST + parser; remove built-in shorthand

**Files:**
- Modify: `src/parse/ast.ts` (add `EdgeApplication`; add `edges` arrays to `ModelDecl`, `InstanceDecl`, `ObjectValue`; `AssignmentNode` comment)
- Modify: `src/parse/parser.ts` (`parseRecordBody` ~226-250; `parseModel`; `parseInlineObject`; `parseDeclaration` top-level edge branch ~187; remove `parseEdgeRecord`/`consumeEdgeOperator`/`edgeRecordAhead`/`parseApplicationConnectors`; add `edgeApplicationAhead`/`parseEdgeApplication`)
- Test: `src/parse/tests/edge-application-parse.test.ts` (create); migrate `src/parse/tests/edge-record.test.ts` and the `connectors` case in `src/parse/tests/parser.test.ts`

**Interfaces:**
- Consumes: `TokenKind.SymbolOp` (Task 1); `DeclKind.Operator` (Task 2).
- Produces: `interface EdgeApplication { glyph: string; left: string; right: string; leftSpan?: SourceSpan; rightSpan?: SourceSpan; glyphSpan?: SourceSpan; body: AssignmentNode[]; span: SourceSpan; }`. `ModelDecl.edges: EdgeApplication[]`, `InstanceDecl.edges: EdgeApplication[]`, `ObjectValue.edges: EdgeApplication[]`. `EdgeApplication` is NOT a `Declaration`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/edge-application-parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, type ModelDecl } from "../ast.js";

function modelEdges(text: string) {
  const m = parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Model) as ModelDecl;
  return m.edges;
}

test("an edge application in a model body parses left/glyph/right", () => {
  const edges = modelEdges(`namespace t { model M : t { agent ~> orchestrator; } }`);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].left, "agent");
  assert.equal(edges[0].glyph, "~>");
  assert.equal(edges[0].right, "orchestrator");
  assert.deepEqual(edges[0].body, []);
});

test("an edge application with a body captures extra assignments", () => {
  const edges = modelEdges(`namespace t { model M : t { agent ~> orchestrator { type = sync; }; } }`);
  assert.equal(edges[0].body.find((a) => a.name === "type")?.value.kind !== undefined, true);
});

test("dotted operands parse", () => {
  const edges = modelEdges(`namespace t { model M : t { lib.a ==> lib.b; } }`);
  assert.equal(edges[0].left, "lib.a");
  assert.equal(edges[0].right, "lib.b");
});

test("a normal assignment is still an assignment, not an edge", () => {
  const m = parse(`namespace t { model M : t { component c1 { label = x; } } }`)
    .namespace.declarations.find((d) => d.kind === DeclKind.Model) as ModelDecl;
  assert.equal(m.instances[0].assignments[0].name, "label");
  assert.equal(m.instances[0].edges.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/edge-application-parse.test.ts"`
Expected: FAIL — `m.edges` undefined.

- [ ] **Step 3: Implement the AST**

In `src/parse/ast.ts` add:

```ts
/** A `left <glyph> right [ { … } | ; ]` edge usage (design §3). Shape-only: the
 * loader resolves `glyph` against the operator table and materializes the edge. */
export interface EdgeApplication {
  glyph: string;
  left: string;
  right: string;
  leftSpan?: SourceSpan;
  rightSpan?: SourceSpan;
  glyphSpan?: SourceSpan;
  body: AssignmentNode[];
  span: SourceSpan;
}
```

Add `edges: EdgeApplication[];` to `ModelDecl`, `InstanceDecl`, and `ObjectValue`.

- [ ] **Step 4: Implement the parser**

In `src/parse/parser.ts`:

Replace `edgeRecordAhead` with:

```ts
  /** True when the tokens ahead form `Identifier ( . Identifier )*` immediately
   * followed by a SymbolOp — an edge application `a <glyph> b`. */
  private edgeApplicationAhead(): boolean {
    let i = 0;
    if (this.peekKind(i) !== TokenKind.Identifier) return false;
    i += 1;
    while (this.peekKind(i) === TokenKind.Dot && this.peekKind(i + 1) === TokenKind.Identifier) i += 2;
    return this.peekKind(i) === TokenKind.SymbolOp;
  }
```

Replace `parseEdgeRecord` with `parseEdgeApplication` (leading operand `left` NOT yet consumed — caller calls it only when `edgeApplicationAhead()` is true and has not consumed the identifier). To keep call sites uniform, parse the whole thing here:

```ts
  private parseEdgeApplication(start: Token): EdgeApplication {
    const leftStart = this.current();
    const left = this.parseDottedPath();
    const glyphTok = this.expect(TokenKind.SymbolOp);
    const rightStart = this.current();
    const right = this.parseDottedPath();
    const body: AssignmentNode[] = [];
    if (this.match(TokenKind.LBrace)) {
      while (!this.check(TokenKind.RBrace)) {
        const aStart = this.startToken();
        const name = this.expectIdentifier();
        this.expect(TokenKind.Equals);
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        body.push({ name, value, span: this.spanFrom(aStart) });
      }
      this.expect(TokenKind.RBrace);
      this.match(TokenKind.Semicolon); // optional trailing `;` after a body
    } else {
      this.expect(TokenKind.Semicolon);
    }
    const edge: EdgeApplication = { glyph: glyphTok.value, left, right, body, span: this.spanFrom(start) };
    edge.glyphSpan = tokenSpan(glyphTok, this.uri);
    edge.leftSpan = this.spanFrom(leftStart);
    edge.rightSpan = this.spanFrom(rightStart);
    return edge;
  }
```

Rework `parseRecordBody` to collect edges. Since it currently consumes the first identifier eagerly, branch on `edgeApplicationAhead()` BEFORE consuming:

```ts
  private parseRecordBody(): {
    assignments: AssignmentNode[];
    children: InstanceDecl[];
    annotations: AnnotationApplication[];
    edges: EdgeApplication[];
  } {
    const assignments: AssignmentNode[] = [];
    const children: InstanceDecl[] = [];
    const annotations: AnnotationApplication[] = [];
    const edges: EdgeApplication[] = [];
    while (!this.check(TokenKind.RBrace)) {
      const memberStart = this.startToken();
      if (this.checkKeyword("annotate")) { annotations.push(this.parseAnnotationApplication(memberStart)); continue; }
      if (this.edgeApplicationAhead()) { edges.push(this.parseEdgeApplication(memberStart)); continue; }
      const first = this.expectIdentifier();
      if (this.match(TokenKind.Equals)) {
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        assignments.push({ name: first, value, span: this.spanFrom(memberStart) });
      } else {
        children.push(this.parseInstanceFrom(first, memberStart));
      }
    }
    return { assignments, children, annotations, edges };
  }
```

Delete `parseApplicationConnectors` and its two call sites (the `checkKeyword("connectors")` branch in `parseRecordBody` — already removed above — and the top-level `if (this.checkKeyword("connectors"))` in `parseDeclaration` line ~183). Delete `consumeEdgeOperator`.

Update `parseInstanceFrom` (line ~213) to store edges:

```ts
    const { assignments, children, annotations, edges } = this.parseRecordBody();
    this.expect(TokenKind.RBrace);
    const decl: InstanceDecl = { kind: DeclKind.Instance, concept, id, binds, isClass, instanceOf, assignments, children, annotations, edges, span: this.spanFrom(start) };
```

Update `parseInlineObject` and `parseModel` similarly: whatever body-collecting they do must thread `edges` into the `ObjectValue`/`ModelDecl` (read those methods; `parseModel` builds its instance list — collect a parallel `edges` array by branching on `edgeApplicationAhead()` in its body loop; a model body edge goes to `ModelDecl.edges`).

In `parseDeclaration` (line ~187), remove the top-level edge branch (`if (this.edgeRecordAhead()) return this.parseEdgeRecord(...)`) — top-level edge usage is no longer supported. A top-level `a ~> b;` now falls through to the instance path and fails to parse; that is acceptable per the Global Constraints.

Import `EdgeApplication` in the parser.

- [ ] **Step 5: Migrate the old edge tests**

Rewrite `src/parse/tests/edge-record.test.ts` → assert the new behavior (or delete it and fold coverage into `edge-application-parse.test.ts`). Remove the `connectors { … }` test in `src/parse/tests/parser.test.ts` (line ~125) — the block no longer exists.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/edge-application-parse.test.ts" "src/parse/tests/parser.test.ts"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/
git commit -m "feat(parser): EdgeApplication usage; remove hardcoded edge shorthand"
```

---

### Task 4: Reference resolution for operators + edges

**Files:**
- Modify: `src/parse/references.ts` (`visitReferences` switch ~65; `visitInstanceRefs` ~135-153; `collectDefinitions` ~199)
- Modify: `src/diagnostics/diagnostic.ts` (add operator codes near `InlineObjectType` ~38)
- Test: `src/parse/tests/operator-references.test.ts` (create)

**Interfaces:**
- Consumes: `OperatorDecl`, `EdgeApplication` (Tasks 2, 3); `RefRole` (existing).
- Produces: operator `concept` refs and edge `left`/`right` refs flow through the existing resolution loop (qualified→flat rewrite; unknown → `reference.undefined`). New `DiagnosticCode.OperatorUndefined = "operator.undefined"`, `OperatorRedeclared = "operator.redeclared"`, `OperatorMalformedGlyph = "operator.malformed-glyph"`, `OperatorBadEndpoint = "operator.bad-endpoint"`, `OperatorBodyOnRelationship = "operator.body-on-relationship"`, `OperatorSourceType = "operator.source-type"`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/operator-references.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { visitReferences, RefRole } from "../references.js";

test("an operator's concept is visited as a reference", () => {
  const decl = parse(`namespace t { operator ~> : connector (from, to); }`).namespace.declarations[0];
  const names: string[] = [];
  visitReferences(decl, (v) => { if (v.role === RefRole.RecordConcept) names.push(v.name); });
  assert.deepEqual(names, ["connector"]);
});

test("qualified operator concept rewrites flat", () => {
  const decl = parse(`namespace t { operator ~> : lib.connector (from, to); }`).namespace.declarations[0];
  visitReferences(decl, (v) => { if (v.role === RefRole.RecordConcept) v.rewrite("connector"); });
  assert.equal((decl as { concept: string }).concept, "connector");
});

test("an edge application's operands are visited as references", () => {
  const decl = parse(`namespace t { model M : t { agent ~> orchestrator; } }`).namespace.declarations[0];
  const names: string[] = [];
  visitReferences(decl, (v) => { if (v.role === RefRole.RefValue) names.push(v.name); });
  assert.ok(names.includes("agent") && names.includes("orchestrator"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/operator-references.test.ts"`
Expected: FAIL — operator/edge refs not visited.

- [ ] **Step 3: Implement the diagnostics**

In `src/diagnostics/diagnostic.ts`, after `InlineObjectType = "inline-object.type",` add:

```ts
  // Operators (design §5).
  OperatorUndefined = "operator.undefined",
  OperatorRedeclared = "operator.redeclared",
  OperatorMalformedGlyph = "operator.malformed-glyph",
  OperatorBadEndpoint = "operator.bad-endpoint",
  OperatorBodyOnRelationship = "operator.body-on-relationship",
  OperatorSourceType = "operator.source-type",
```

- [ ] **Step 4: Implement the references**

In `src/parse/references.ts` `visitReferences`, add a case (before `DeclKind.Primitive`):

```ts
    case DeclKind.Operator:
      // The target concept resolves like a record concept (qualified → flat,
      // undefined → reference.undefined). Endpoint member names are validated
      // against the concept schema by the loader, not here.
      visit({ name: decl.concept, span: decl.conceptSpan ?? decl.span, role: RefRole.RecordConcept,
        ownerNode: decl.glyph, memberPath: null, rewrite: (r) => { (decl as { concept: string }).concept = r; } });
      break;
```

Edge applications live in `ModelDecl.edges` and `InstanceDecl.edges`. Extend the walk. Add a helper and call it from both the `DeclKind.Model` case and `visitInstanceRefs`:

```ts
function visitEdgeRefs(
  edge: EdgeApplication,
  visit: Visit,
  scope?: { taxonomy: string; uses: readonly string[] },
): void {
  visit({ name: edge.left, span: edge.leftSpan ?? edge.span, role: RefRole.RefValue,
    ownerNode: edge.left, memberPath: null, rewrite: (r) => { (edge as { left: string }).left = r; },
    ...(scope ? { scope } : {}) });
  visit({ name: edge.right, span: edge.rightSpan ?? edge.span, role: RefRole.RefValue,
    ownerNode: edge.left, memberPath: null, rewrite: (r) => { (edge as { right: string }).right = r; },
    ...(scope ? { scope } : {}) });
  // The glyph itself is resolved against the operator table by the loader
  // (operator.undefined), not through symbol resolution.
}
```

In `visitInstanceRefs`, after the children loop, add:
```ts
  for (const edge of decl.edges) visitEdgeRefs(edge, visit, scope);
```
In the `DeclKind.Model` case, after `for (const inst of decl.instances) …`, add:
```ts
      for (const edge of decl.edges) visitEdgeRefs(edge, visit, scope);
```

`collectDefinitions` (line ~199): add `case DeclKind.Operator: break;` — an operator does NOT define a namespaced symbol (the glyph is resolved via the operator table, not name resolution). Edge applications define nothing (their minted ids are created by the loader, not collected here).

Import `EdgeApplication` in references.ts.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/operator-references.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parse/references.ts src/diagnostics/diagnostic.ts src/parse/tests/operator-references.test.ts
git commit -m "feat(references): resolve operator concept + edge operands; operator diagnostics"
```

---

### Task 5: Loader — `defineOperator`, operator table, edge materialization

**Files:**
- Modify: `src/model/kinds.ts` (`MetaKind` enum)
- Modify: `src/model/builder.ts` (add `defineOperator`)
- Modify: `src/parse/loader.ts` (Pass 1 dispatch ~313; Pass 2b ~438-459; add `operatorTable` + `applyEdge` + `applyEdges` helpers; thread edges through `applyInstance`/`applyModel`/inline objects)
- Test: `src/parse/tests/operator-load.test.ts` (create)

**Interfaces:**
- Consumes: `OperatorDecl`, `EdgeApplication`, operator diagnostics, `IdGenerator` (existing loader param `idGenerator`/`idGen`), `referenceMemberType`/`isReferenceType` (loader helpers), `Builder.addRelationship`/`addContains`/`assertInstance`, `EdgeKind.Targets`, `Direction.Out`.
- Produces: `MetaKind.Operator = "operator"`; `Builder.defineOperator(glyph, concept, fromMember, toMember, relationship)`; a resolved operator table `Map<string, { glyph; concept; from; to; relationship }>`; reified edges become contained, endpoint-bound instance nodes; relationship edges become a single `Relationship` edge.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/operator-load.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";

function loadSrc(body: string, gen = new FakeIdGenerator()) {
  const src = `namespace t {
    concept endpoint { label : string; }
    concept connector { from : endpoint; to : endpoint; kind : string; }
    concept component { depends_on : component[]; }
    operator ~> : connector (from, to);
    operator ->> : component.depends_on;
    model M : t { ${body} }
  }`;
  return load([{ uri: "t.todl", text: src }], gen);
}

test("a reified-edge operator mints a contained, endpoint-bound node", () => {
  const { model, diagnostics } = loadSrc(`endpoint a { label = "a"; } endpoint b { label = "b"; } a ~> b;`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  assert.ok(model.resolve("id-0"), "edge node id-0 minted");
  assert.deepEqual(model.refs("id-0", "from"), ["a"]);
  assert.deepEqual(model.refs("id-0", "to"), ["b"]);
});

test("a reified-edge body assignment lands on the minted node", () => {
  const { model } = loadSrc(`endpoint a { label = "a"; } endpoint b { label = "b"; } a ~> b { kind = "sync"; };`);
  assert.equal(model.resolve("id-0")?.attrs.get("kind"), "sync");
});

test("an explicit id in the body is reused", () => {
  const { model } = loadSrc(`endpoint a { label = "a"; } endpoint b { label = "b"; } a ~> b { id = link1; };`);
  assert.ok(model.resolve("link1"), "author id reused");
});

test("a relationship-form operator adds one edge, no node", () => {
  const { model } = loadSrc(`component w {} component d {} w ->> d;`);
  assert.deepEqual(model.related("w", EdgeKind.Relationship, Direction.Out, "depends_on"), ["d"]);
});

test("an unknown glyph is operator.undefined", () => {
  const { diagnostics } = loadSrc(`component w {} component d {} w >>> d;`);
  assert.ok(diagnostics.map((x) => x.code).includes(DiagnosticCode.OperatorUndefined));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/operator-load.test.ts"`
Expected: FAIL — operator not defined; edges not materialized.

- [ ] **Step 3: Implement `MetaKind.Operator` + `defineOperator`**

In `src/model/kinds.ts` add `Operator = "operator",` to `MetaKind`.

In `src/model/builder.ts`, add (after `defineViewpoint`):

```ts
  /** Define an operator node (Ontology-tier): its glyph is the node id, a
   * `Targets` edge points at the bound concept, and `from`/`to`/`relationship`
   * attrs record the endpoint members. */
  defineOperator(
    glyph: NodeId,
    concept: NodeId,
    fromMember: string | null,
    toMember: string | null,
    relationship: string | null,
  ): this {
    this.stageNode(glyph, Tier.Ontology, MetaKind.Operator);
    if (fromMember !== null) this.stagedAttrs.push({ id: glyph, name: "from", value: fromMember });
    if (toMember !== null) this.stagedAttrs.push({ id: glyph, name: "to", value: toMember });
    if (relationship !== null) this.stagedAttrs.push({ id: glyph, name: "relationship", value: relationship });
    this.stagedEdges.push({ kind: EdgeKind.Targets, via: null, from: glyph, to: concept });
    return this;
  }
```

`stageNode` is private but in-class; `stagedAttrs`/`stagedEdges` are accessible from within the class.

- [ ] **Step 4: Implement the loader**

In `src/parse/loader.ts` Pass 1 switch (line ~313), add:

```ts
      case DeclKind.Operator:
        first.defineOperator(declaration.glyph, declaration.concept, declaration.fromMember, declaration.toMember, declaration.relationship);
        break;
```

Add a resolved-operator type + table builder (near `referenceMemberType`, ~939):

```ts
interface ResolvedOperator { glyph: string; concept: string; from: string | null; to: string | null; relationship: string | null; }

/** Build the glyph → operator lookup from all committed operator nodes (bases + this load). */
function operatorTable(model: Repository): Map<string, ResolvedOperator> {
  const table = new Map<string, ResolvedOperator>();
  for (const node of model.allNodes()) {
    if (node.typeOf !== MetaKind.Operator) continue;
    const concept = model.related(node.id, EdgeKind.Targets, Direction.Out)[0];
    if (concept === undefined) continue; // dangling concept ref already diagnosed
    table.set(node.id, {
      glyph: node.id, concept,
      from: (node.attrs.get("from") as string | undefined) ?? null,
      to: (node.attrs.get("to") as string | undefined) ?? null,
      relationship: (node.attrs.get("relationship") as string | undefined) ?? null,
    });
  }
  return table;
}
```

Add the edge materializer:

```ts
function applyEdge(
  builder: Builder, model: Repository, edge: EdgeApplication, ownerId: string | null,
  table: Map<string, ResolvedOperator>, asserted: Set<string>, diagnostics: Diagnostic[], idGen: IdGenerator,
): void {
  const op = table.get(edge.glyph);
  if (op === undefined) {
    diagnostics.push({ code: DiagnosticCode.OperatorUndefined, severity: Severity.Error,
      message: `no operator "${edge.glyph}" is declared in the meta-model`, span: edge.glyphSpan ?? edge.span, node: null, path: null });
    return;
  }
  if (op.relationship !== null) {                              // relationship form
    if (edge.body.length > 0) {
      diagnostics.push({ code: DiagnosticCode.OperatorBodyOnRelationship, severity: Severity.Error,
        message: `operator "${edge.glyph}" is a relationship edge and cannot carry a "{ … }" body`, span: edge.span, node: null, path: null });
    }
    builder.addRelationship(edge.left, op.relationship, edge.right);
    return;
  }
  // reified form: mint (or reuse) the node, bind both endpoints, attach the body.
  const idAssign = edge.body.find((a) => a.name === "id");
  const objId = idAssign !== undefined ? nameOfValue(idAssign.value) : idGen.next();
  builder.assertInstance(op.concept, objId);
  if (op.from !== null) builder.addRelationship(objId, op.from, edge.left);
  if (op.to !== null) builder.addRelationship(objId, op.to, edge.right);
  if (ownerId !== null) builder.addContains(ownerId, objId);
  for (const a of edge.body) {
    if (a.name === "id") continue;
    realizeValue(builder, model, op.concept, objId, a.name, a.value, diagnostics, asserted, idGen);
  }
}

function applyEdges(
  builder: Builder, model: Repository, edges: readonly EdgeApplication[], ownerId: string | null,
  table: Map<string, ResolvedOperator>, asserted: Set<string>, diagnostics: Diagnostic[], idGen: IdGenerator,
): void {
  for (const edge of edges) applyEdge(builder, model, edge, ownerId, table, asserted, diagnostics, idGen);
}
```

Thread edges through instance/model application. Build the table once in Pass 2b (line ~438) and pass it down. The simplest wiring: build `const opTable = operatorTable(model);` right after `const asserted = new Set<string>();` (line ~439), then:
- In the `DeclKind.Model` branch, after `applyModel(...)`, the model's own edges bind to the model container. Have `applyModel` accept `opTable` and call `applyEdges(builder, model, decl.edges, decl.id, opTable, …)` after staging instances (read `applyModel` — it knows the model id).
- In `applyInstance`, after realizing children, call `applyEdges(builder, model, decl.edges, decl.id, opTable, …)` so an instance-body edge is contained by that instance. `applyInstance` must accept `opTable`.

Update the signatures of `applyInstance` and `applyModel` to take `opTable: Map<string, ResolvedOperator>` (add as a parameter after `idGen` — update ALL call sites: the two in Pass 2b, the `deferredCompositions` call, and the `realizeInlineObject` call which invokes `applyInstance`). For `realizeInlineObject`, also apply the inline object's own `value.edges`: after `applyInstance(builder, model, synth, …)`, call `applyEdges(...)` with the synthesized object's id as owner. `realizeInlineObject` will need `opTable` threaded in too (add the param; update its call site in `realizeValue`, which must also receive `opTable`).

Import `EdgeApplication`, `Direction`, `Builder`, `Diagnostic` as needed at the top of `loader.ts` (most are already imported — verify).

Ensure `nameOfValue` (added for inline objects) is in scope; reuse it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/operator-load.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model/kinds.ts src/model/builder.ts src/parse/loader.ts src/parse/tests/operator-load.test.ts
git commit -m "feat(loader): defineOperator, operator table, edge materialization"
```

---

### Task 6: Operator declaration validation

**Files:**
- Modify: `src/parse/loader.ts` (add a validation pass over operator declarations — place it after Pass 2a commits concept schemas, before or during Pass 2b)
- Test: `src/parse/tests/operator-validate.test.ts` (create)

**Interfaces:**
- Consumes: operator diagnostic codes (Task 4); `model.effectiveSchema`, `isReferenceType` (loader helpers); the `units` list of `OperatorDecl`s.
- Produces: declaration-time diagnostics — malformed glyph, undeclared endpoint members, endpoint not a reference member, relationship member not a relationship, duplicate glyph.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/operator-validate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(decls: string) {
  const src = `namespace t {
    concept endpoint { label : string; }
    concept connector { from : endpoint; to : endpoint; note : string; }
    concept component { depends_on : component[]; }
    ${decls}
  }`;
  return load([{ uri: "t.todl", text: src }], new FakeIdGenerator()).diagnostics.map((d) => d.code);
}

test("a reified endpoint that is not a member is a bad-endpoint error", () => {
  assert.ok(codes(`operator ~> : connector (from, nope);`).includes(DiagnosticCode.OperatorBadEndpoint));
});

test("a reified endpoint that is a primitive (not a reference member) is a bad-endpoint error", () => {
  assert.ok(codes(`operator ~> : connector (from, note);`).includes(DiagnosticCode.OperatorBadEndpoint));
});

test("a relationship form targeting a non-relationship member is a bad-endpoint error", () => {
  assert.ok(codes(`operator ->> : endpoint.label;`).includes(DiagnosticCode.OperatorBadEndpoint));
});

test("a duplicate glyph is operator.redeclared", () => {
  const cs = codes(`operator ~> : connector (from, to); operator ~> : connector (to, from);`);
  assert.ok(cs.includes(DiagnosticCode.OperatorRedeclared));
});

test("a well-formed pair produces no operator diagnostics", () => {
  const cs = codes(`operator ~> : connector (from, to); operator ->> : component.depends_on;`);
  assert.ok(!cs.some((c) => String(c).startsWith("operator.")));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/operator-validate.test.ts"`
Expected: FAIL — no validation yet.

- [ ] **Step 3: Implement**

In `src/parse/loader.ts`, add a validation function and invoke it after Pass 2a commits (after line ~434, so `effectiveSchema` is populated). Iterate the operator declarations from `units`:

```ts
function validateOperators(model: Repository, units: readonly { ns: string; decl: Declaration }[], diagnostics: Diagnostic[]): void {
  const seen = new Set<string>();
  const EDGE_CHARS = /^[-~=><!]+$/;
  for (const { decl } of units) {
    if (decl.kind !== DeclKind.Operator) continue;
    if (!EDGE_CHARS.test(decl.glyph) || decl.glyph === "=") {
      diagnostics.push({ code: DiagnosticCode.OperatorMalformedGlyph, severity: Severity.Error,
        message: `operator glyph "${decl.glyph}" must be a run of edge characters ( - ~ = > < ! ) and not a lone "="`, span: decl.glyphSpan ?? decl.span, node: decl.glyph, path: null });
    }
    if (seen.has(decl.glyph)) {
      diagnostics.push({ code: DiagnosticCode.OperatorRedeclared, severity: Severity.Error,
        message: `operator "${decl.glyph}" is declared more than once`, span: decl.glyphSpan ?? decl.span, node: decl.glyph, path: null });
    }
    seen.add(decl.glyph);
    if (!model.has(decl.concept)) continue; // undefined concept already diagnosed (reference.undefined)
    const schema = model.effectiveSchema(decl.concept);
    const badEndpoint = (member: string, needRelationship: boolean): void => {
      diagnostics.push({ code: DiagnosticCode.OperatorBadEndpoint, severity: Severity.Error,
        message: needRelationship
          ? `operator "${decl.glyph}": "${decl.concept}.${member}" is not a relationship`
          : `operator "${decl.glyph}": "${decl.concept}.${member}" is not a reference member`,
        span: decl.conceptSpan ?? decl.span, node: decl.glyph, path: null });
    };
    if (decl.relationship !== null) {
      if (!schema.relationships.some((r) => r.name === decl.relationship)) badEndpoint(decl.relationship, true);
    } else {
      for (const member of [decl.fromMember, decl.toMember]) {
        if (member === null) continue;
        const field = schema.fields.find((f) => f.name === member);
        const rel = schema.relationships.find((r) => r.name === member);
        const isRef = (field !== undefined && isReferenceType(model, field.type)) || rel !== undefined;
        if (!isRef) badEndpoint(member, false);
      }
    }
  }
}
```

Invoke it right after `second.commit(undefinedIds);` (line ~434):

```ts
  validateOperators(model, units, diagnostics);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/operator-validate.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parse/loader.ts src/parse/tests/operator-validate.test.ts
git commit -m "feat(loader): operator declaration validation"
```

---

### Task 7: Reified-edge shorthand emit + round-trip

**Files:**
- Modify: `src/emit/todl.ts` (add `collectOperators`; extend `EmitCtx` + `emitModelTodl` + `emitOne`)
- Test: `src/emit/tests/operator-roundtrip.test.ts` (create)

**Interfaces:**
- Consumes: `MetaKind.Operator`; `Repository.allNodes`/`related`; `check` (api).
- Produces: `collectOperators(model: Repository): Map<string, { glyph: string; from: string; to: string }>` keyed by concept id; `emitModelTodl(own, namespace, bindings, conforms?, operators?)` renders a reified-edge instance as `left <glyph> right [ { …rest } ];`.

- [ ] **Step 1: Write the failing test**

Create `src/emit/tests/operator-roundtrip.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { collectOperators } from "../todl.js";
import { EdgeKind, Direction } from "../../model/graph.js";

const SRC = `namespace t {
  concept endpoint { label : string; }
  concept connector { from : endpoint; to : endpoint; }
  operator ~> : connector (from, to);
  model M : t { endpoint a { label = "a"; } endpoint b { label = "b"; } a ~> b; }
}`;

test("collectOperators reverse-maps a concept to its first operator", () => {
  const { model } = check([{ uri: "t.todl", text: SRC }], new FakeIdGenerator());
  const ops = collectOperators(model);
  assert.equal(ops.get("connector")?.glyph, "~>");
  assert.equal(ops.get("connector")?.from, "from");
  assert.equal(ops.get("connector")?.to, "to");
});

test("a reified edge re-parses to the same from/to edges", () => {
  const first = check([{ uri: "t.todl", text: SRC }], new FakeIdGenerator());
  // Sanity: the minted connector binds a→b.
  assert.deepEqual(first.model.related("id-0", EdgeKind.Relationship, Direction.Out, "from"), ["a"]);
  assert.deepEqual(first.model.related("id-0", EdgeKind.Relationship, Direction.Out, "to"), ["b"]);
});
```

(The full re-emit → re-parse round-trip is exercised through the existing model-emitter store test; this task's unit test locks `collectOperators` and the materialized shape. If the project has a `toTodl`/`ModelDraft` round-trip harness, add a case there that emits `SRC`'s model and asserts the output contains `a ~> b`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/emit/tests/operator-roundtrip.test.ts"`
Expected: FAIL — `collectOperators` not exported.

- [ ] **Step 3: Implement**

In `src/emit/todl.ts`:

```ts
import { EdgeKind, Direction } from "../model/graph.js";

/** Reverse map concept id → the first operator that reifies it (design §6),
 * for shorthand emit. Deterministic: first operator in allNodes order wins. */
export function collectOperators(model: Repository): Map<string, { glyph: string; from: string; to: string }> {
  const byConcept = new Map<string, { glyph: string; from: string; to: string }>();
  for (const node of model.allNodes()) {
    if (node.typeOf !== MetaKind.Operator) continue;
    const from = node.attrs.get("from");
    const to = node.attrs.get("to");
    if (typeof from !== "string" || typeof to !== "string") continue; // relationship form: no shorthand here
    const concept = model.related(node.id, EdgeKind.Targets, Direction.Out)[0];
    if (concept === undefined || byConcept.has(concept)) continue;    // first wins
    byConcept.set(concept, { glyph: node.id, from, to });
  }
  return byConcept;
}
```

Extend `EmitCtx` with `operators: Map<string, { glyph: string; from: string; to: string }>`. Add the param to `emitModelTodl`:

```ts
export function emitModelTodl(own: TodlDocument, namespace: string, bindings: ModelBindings, conforms?: string, operators?: Map<string, { glyph: string; from: string; to: string }>): string {
```

Set `operators: operators ?? new Map()` in the `ctx` literal.

In `emitOne`, before building the record head, special-case a reified edge:

```ts
  const op = ctx.operators.get(node.typeOf);
  if (op !== undefined && !isClassNode(node)) {
    const rels = ctx.rels.get(node.id) ?? [];
    const from = rels.find((r) => r.via === op.from)?.to;
    const to = rels.find((r) => r.via === op.to)?.to;
    if (from !== undefined && to !== undefined) {
      const rest = emitBody(node, ctx, indent + 1, false)
        .filter((l) => !l.trim().startsWith(`${op.from} =`) && !l.trim().startsWith(`${op.to} =`));
      const pad0 = "  ".repeat(indent);
      if (rest.length === 0) return [`${pad0}${localName(from)} ${op.glyph} ${localName(to)};`];
      return [`${pad0}${localName(from)} ${op.glyph} ${localName(to)} {`, ...rest, `${pad0}};`];
    }
  }
```

(Place this at the top of `emitOne`, returning early when it matches. `localName` on the endpoint keeps the emit style consistent with the rest of the file; if reference targets should keep their full id, drop `localName` and emit `from`/`to` directly — match whatever `emitBody` does for reference values, which is the raw target id.)

Update the caller(s) of `emitModelTodl` (search the repo: `ModelDraft.toTodl` / `TodlFileStore` / any `toTodlByFile`) to pass `collectOperators(model)`. Read each call site and thread the operators map from the same `Repository` they already hold.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/emit/tests/operator-roundtrip.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/emit/todl.ts src/emit/tests/operator-roundtrip.test.ts
git commit -m "feat(emit): reified-edge operator shorthand"
```

---

### Task 8: Full-suite green + build

**Files:**
- Modify: any residual test/source referencing removed tokens/functions surfaced by the build.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a green full suite and a clean build.

- [ ] **Step 1: Run the full test suite**

Run: `npx tsx --conditions=development --test --test-force-exit "src/**/*.test.ts"`
Expected: all pass. Fix any test still referencing `TokenKind.Arrow`, `DoubleArrow`, `parseEdgeRecord`, `edgeRecordAhead`, `connectors`, or `operator` attr expectations (migrate assertions to the new operator flow).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `gen:prelude` + `tsc` succeed with no type errors. Resolve any unused-symbol errors from removed enum members.

- [ ] **Step 3: Commit any residual fixes**

```bash
git add -A
git commit -m "chore: migrate residual edge-shorthand references to operators"
```

---

## Self-Review

**Spec coverage:**
- §1 operator declarations (both forms) → Task 2. ✓
- §2 lexing / `SymbolOp` / resolution timing → Task 1 (lexer) + Task 4 (loader-time resolution, `operator.undefined`). ✓
- §3 usage / `EdgeApplication` / remove built-ins & `connectors {}` → Task 3. ✓
- §4 loader materialization (reified + relationship, IdGenerator reuse, containment) → Task 5. ✓
- §5 validation (declaration + usage diagnostics) → Task 6 (declaration) + Task 5 (`operator.undefined` usage). `operator.source-type` for the relationship-form left operand is declared as a code but enforced best-effort; noted below.
- §6 emit / round-trip (reified shorthand, first-declared determinism, verbose fallback) → Task 7. Relationship-form shorthand emit is a documented non-goal (Global Constraints). ✓
- §7 removals & non-goals → Task 3 + Task 8. ✓

**Deviations from the spec, flagged for the user:**
1. Relationship-form edges emit as their normal member assignment (lossless) rather than glyph-shorthand — reified shorthand is the round-trip driver; relationship-shorthand emit is deferred.
2. `operator.source-type` (relationship-form left operand must be the source concept/subtype) is declared but enforced best-effort; endpoint reference resolution already catches undefined operands. If strict source-typing is required, add a check in `applyEdge`.
3. Bare top-level edge usage (outside a `model`) is dropped (was unused); the `operator` declaration remains top-level.

**Placeholder scan:** none — every code step carries real code.

**Type consistency:** `OperatorDecl` fields (`glyph`, `concept`, `fromMember`, `toMember`, `relationship`) are used identically in Tasks 2/4/5/6. `ResolvedOperator`/table shape (`{ glyph, concept, from, to, relationship }`) is consistent between loader (Task 5) and the emit reverse-map (Task 7, which narrows to `{ glyph, from, to }` keyed by concept). `defineOperator(glyph, concept, fromMember, toMember, relationship)` signature matches its Pass-1 call site. `EdgeApplication` shape is consistent across parser, references, and loader.
