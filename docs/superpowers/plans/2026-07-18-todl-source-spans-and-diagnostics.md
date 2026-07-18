# TODL Source Spans, Unified Diagnostics & Parser Recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every TODL diagnostic (lex / parse / validate) carries a `SourceSpan` (file + start/end line:column); `parse` and `load` recover from errors and return diagnostic lists instead of throwing on the first one; a `check()` convenience runs load+validate; then publish `@pragmatic-lab/todl` so Plexus can show inline editor squiggles.

**Architecture:** Spans are captured at the lexer (each `Token` records its end position, since a string token's decoded `value` ≠ its source length) and threaded through the AST (each node gets a `span`) into the Model (a `NodeId`/member → span map). A single `Diagnostic` type spans all phases. The lexer and parser recover: the lexer skips bad characters emitting a diagnostic; the parser catches per-declaration errors, records a diagnostic, and re-synchronizes to the next declaration boundary.

**Tech Stack:** TypeScript (ESM, strict), `node:test` + `node:assert/strict` via `tsx`, published to a local Verdaccio registry.

## Global Constraints

- Test runner: `npm test` → `tsx --conditions=development --test "src/**/*.test.ts"`. Run a single file with `tsx --conditions=development --test src/path/tests/x.test.ts`.
- **Every test file lives in a `tests/` subfolder next to the code it exercises** (`src/model/tests/…`), never beside the source.
- Positions are **1-based line and 1-based column**, matching the existing lexer and Monaco's marker model.
- `SourceSpan.end` is **exclusive** (one past the last character) — it equals the lexer's cursor position immediately after the token.
- Publish target: Verdaccio at `http://localhost:4873` (same registry Plexus consumes mural/fresco from). Version bump `0.0.1` → `0.1.0`.
- Author commits as `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; end commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- Create `src/diagnostics/diagnostic.ts` — `Severity`, `DiagnosticCode` (all phases), `Diagnostic` (with `span`). The single diagnostic type.
- Create `src/diagnostics/span.ts` — `Position`, `SourceSpan`, `SourceFile`, `tokenSpan(token, uri)`.
- Modify `src/parse/lexer.ts` — `Token` gains `endLine`/`endColumn`; add `lex(source, uri)` returning `{ tokens, diagnostics }` with lexical recovery; `tokenize` stays as a token-only wrapper.
- Modify `src/parse/ast.ts` — every node type gains `span: SourceSpan`.
- Modify `src/parse/parser.ts` — thread `uri`, stamp node spans, `ParseError` carrying a token, `parse(text, uri): ParseResult`, declaration-boundary recovery + `synchronize()`.
- Modify `src/model/model.ts` — a `Map<string, SourceSpan>` span store: `recordSpan(key, span)` / `spanOf(key)`; `memberKey(node, member)` helper.
- Modify `src/parse/loader.ts` — `load(sources: SourceFile[]): LoadResult`; records declaration/instance/assignment spans on the Model.
- Modify `src/validate/validate.ts` — re-export `Diagnostic`/`Severity`/`DiagnosticCode` from `diagnostics/`; enrich each diagnostic with a span.
- Create `src/api.ts` — `check(sources: SourceFile[]): { model, diagnostics }`.
- Modify `src/index.ts` — export the new types/functions.
- Migrate in-repo `parse`/`load` call sites (Tasks 5 and 7).

---

### Task 1: Diagnostic + span types

**Files:**
- Create: `src/diagnostics/span.ts`
- Create: `src/diagnostics/diagnostic.ts`
- Test: `src/diagnostics/tests/diagnostic.test.ts`

**Interfaces:**
- Produces: `Position { line: number; column: number }`, `SourceSpan { uri: string; start: Position; end: Position }`, `SourceFile { uri: string; text: string }`; `Severity`, `DiagnosticCode`, `Diagnostic { code; severity; message; span: SourceSpan | null; node: NodeId | null; path: string | null }`.

- [ ] **Step 1: Write the failing test**

`src/diagnostics/tests/diagnostic.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostic.js";
import type { SourceSpan } from "../span.js";

test("a diagnostic carries a span and syntax codes exist", () => {
  const span: SourceSpan = { uri: "a.todl", start: { line: 1, column: 1 }, end: { line: 1, column: 4 } };
  const d: Diagnostic = {
    code: DiagnosticCode.UnexpectedToken,
    severity: Severity.Error,
    message: "boom",
    span,
    node: null,
    path: null,
  };
  assert.equal(d.span?.uri, "a.todl");
  assert.equal(DiagnosticCode.InvariantFailed, "invariant.failed"); // semantic codes preserved
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --conditions=development --test src/diagnostics/tests/diagnostic.test.ts`
Expected: FAIL — cannot find module `../diagnostic.js` / `../span.js`.

- [ ] **Step 3: Write minimal implementation**

`src/diagnostics/span.ts`:
```ts
import type { Token } from "../parse/lexer.js";

/** 1-based line, 1-based column. */
export interface Position { line: number; column: number }

/** A source range; `end` is exclusive (one past the last character). */
export interface SourceSpan { uri: string; start: Position; end: Position }

/** A named source unit — file identity survives multi-file loads. */
export interface SourceFile { uri: string; text: string }

/** Span a single token using the end position the lexer recorded. */
export function tokenSpan(token: Token, uri: string): SourceSpan {
  return {
    uri,
    start: { line: token.line, column: token.column },
    end: { line: token.endLine, column: token.endColumn },
  };
}
```

`src/diagnostics/diagnostic.ts`:
```ts
import type { NodeId } from "../model/graph.js";
import type { SourceSpan } from "./span.js";

export enum Severity {
  Error = "error",
  Warning = "warning",
}

export enum DiagnosticCode {
  // Lex / parse (syntax) phase.
  UnexpectedCharacter = "syntax.unexpected-character",
  UnterminatedString = "syntax.unterminated-string",
  UnexpectedToken = "syntax.unexpected-token",
  ExpectedToken = "syntax.expected",
  // Semantic phase (unchanged values).
  RequiredMissing = "cardinality.required-missing",
  TooMany = "cardinality.too-many",
  EmptyNotAllowed = "cardinality.empty-not-allowed",
  TargetTypeMismatch = "relationship.target-type",
  InvariantFailed = "invariant.failed",
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  /** Source location; `null` only for genuine whole-model diagnostics. */
  span: SourceSpan | null;
  /** Semantic phase: the offending node; `null` for syntax diagnostics. */
  node: NodeId | null;
  /** Semantic phase: concept-qualified member path (`component.label`); else `null`. */
  path: string | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --conditions=development --test src/diagnostics/tests/diagnostic.test.ts`
Expected: PASS. (`tokenSpan` imports `Token` as a type only; no runtime cycle.)

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics/
git commit -m "feat(diagnostics): unified spanned Diagnostic + Position/SourceSpan/SourceFile

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Token end positions + `tokenSpan`

**Files:**
- Modify: `src/parse/lexer.ts` (Token interface; `scan()` inline pushes; `push()`; EOF token)
- Test: `src/parse/tests/lexer-span.test.ts`

**Interfaces:**
- Consumes: `tokenSpan` (Task 1).
- Produces: `Token { kind; value; line; column; endLine: number; endColumn: number }`.

- [ ] **Step 1: Write the failing test**

`src/parse/tests/lexer-span.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenize, TokenKind } from "../lexer.js";
import { tokenSpan } from "../../diagnostics/span.js";

test("an identifier token records an end one past its last char", () => {
  const [id] = tokenize("alpha");
  assert.equal(id?.line, 1);
  assert.equal(id?.column, 1);
  assert.equal(id?.endLine, 1);
  assert.equal(id?.endColumn, 6); // 'alpha' is 5 chars, end is exclusive
});

test("a multi-line raw string records an end on a later line", () => {
  const tokens = tokenize('"""\nline two\n"""');
  const raw = tokens.find((t) => t.kind === TokenKind.RawString);
  assert.equal(raw?.line, 1);
  assert.equal(raw?.endLine, 3);
  assert.equal(raw?.endColumn, 4); // after the closing """
});

test("tokenSpan reads the token's start/end", () => {
  const [id] = tokenize("alpha");
  const span = tokenSpan(id!, "x.todl");
  assert.deepEqual(span, { uri: "x.todl", start: { line: 1, column: 1 }, end: { line: 1, column: 6 } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --conditions=development --test src/parse/tests/lexer-span.test.ts`
Expected: FAIL — `endLine`/`endColumn` undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/parse/lexer.ts`, extend the `Token` interface:
```ts
export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}
```

The lexer already tracks `this.line`/`this.column`, and at the moment any token is emitted the cursor is one past that token's last consumed character. Capture it. Change the two inline pushes in `scan()`:
```ts
      if (isIdentifierStart(char)) {
        const value = this.readIdentifier();
        this.tokens.push({ kind: TokenKind.Identifier, value, line, column, endLine: this.line, endColumn: this.column });
        continue;
      }
      if (isDigit(char)) {
        const value = this.readNumber();
        this.tokens.push({ kind: TokenKind.Number, value, line, column, endLine: this.line, endColumn: this.column });
        continue;
      }
```
Change the EOF push:
```ts
    this.tokens.push({ kind: TokenKind.EOF, value: "", line: this.line, column: this.column, endLine: this.line, endColumn: this.column });
```
Change `push()` (used by operators and strings) to capture end after consuming:
```ts
  private push(kind: TokenKind, value: string, line: number, column: number, consume: number): void {
    for (let i = 0; i < consume; i++) this.advance();
    this.tokens.push({ kind, value, line, column, endLine: this.line, endColumn: this.column });
  }
```
Update the module-level `EOF_TOKEN` in `parser.ts` (it constructs a `Token` literal) — handled in Task 5; for now `lexer.ts` compiles because all `Token` producers are inside it.

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --conditions=development --test src/parse/tests/lexer-span.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Run the existing lexer/parser tests to confirm no regression**

Run: `tsx --conditions=development --test src/parse/tests/parser.test.ts`
Expected: PASS (the added fields don't affect existing assertions).

- [ ] **Step 6: Commit**

```bash
git add src/parse/lexer.ts src/parse/tests/lexer-span.test.ts
git commit -m "feat(lexer): record token end positions for source spans

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Lexer error recovery (`lex` with diagnostics)

**Files:**
- Modify: `src/parse/lexer.ts` (recover instead of throw; add `lex`)
- Test: `src/parse/tests/lexer-recovery.test.ts`

**Interfaces:**
- Consumes: `Diagnostic`, `DiagnosticCode`, `Severity` (Task 1); `tokenSpan` (Task 1).
- Produces: `lex(source: string, uri: string): { tokens: Token[]; diagnostics: Diagnostic[] }`. `tokenize(source)` remains and returns only tokens.

- [ ] **Step 1: Write the failing test**

`src/parse/tests/lexer-recovery.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { lex, TokenKind } from "../lexer.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

test("an unexpected character is a diagnostic, and lexing continues", () => {
  const { tokens, diagnostics } = lex("alpha $ beta", "x.todl");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, DiagnosticCode.UnexpectedCharacter);
  assert.equal(diagnostics[0]?.span?.start.column, 7);
  // Both identifiers still tokenized (recovery skipped only the '$').
  const idents = tokens.filter((t) => t.kind === TokenKind.Identifier).map((t) => t.value);
  assert.deepEqual(idents, ["alpha", "beta"]);
});

test("an unterminated string is a diagnostic, not a throw", () => {
  const { diagnostics } = lex('name = "oops\n', "x.todl");
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.UnterminatedString));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --conditions=development --test src/parse/tests/lexer-recovery.test.ts`
Expected: FAIL — `lex` not exported (and today the lexer throws).

- [ ] **Step 3: Write minimal implementation**

In `src/parse/lexer.ts`, give the `Lexer` a diagnostics list and a `uri`, replace the two `throw`s with recovery, and add the `lex` entry. Keep `tokenize` as a token-only wrapper.

```ts
import { type Diagnostic, DiagnosticCode, Severity } from "../diagnostics/diagnostic.js";
import { tokenSpan } from "../diagnostics/span.js";

export function tokenize(source: string): Token[] {
  return new Lexer(source, "<anonymous>").scan();
}

export function lex(source: string, uri: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const lexer = new Lexer(source, uri);
  const tokens = lexer.scan();
  return { tokens, diagnostics: lexer.diagnostics };
}
```

Add to the `Lexer` class a public `readonly diagnostics: Diagnostic[] = []` and accept `uri`:
```ts
  constructor(private readonly source: string, private readonly uri: string) {}
```
Add a helper that records a syntax diagnostic at the current single-character position:
```ts
  private report(code: DiagnosticCode, message: string, line: number, column: number, endColumn: number): void {
    this.diagnostics.push({
      code,
      severity: Severity.Error,
      message,
      span: { uri: this.uri, start: { line, column }, end: { line, column: endColumn } },
      node: null,
      path: null,
    });
  }
```
In `readOperator`, replace the throw with report-and-skip:
```ts
    // was: throw new Error(`unexpected character "${char}" at ${line}:${column}`);
    this.report(DiagnosticCode.UnexpectedCharacter, `unexpected character "${char}"`, line, column, column + 1);
    this.advance(); // skip the offending character and continue
```
In `readString`, replace the unterminated throw with a diagnostic and stop at the line end (return what was read so a token still exists):
```ts
      if (this.pos >= this.source.length || this.peek() === "\n") {
        this.report(DiagnosticCode.UnterminatedString, "unterminated string", line, column, this.column);
        return value; // recover: emit the partial string, do not consume the newline/EOF
      }
```
In `readRawString`, replace its throw similarly:
```ts
      if (this.pos >= this.source.length) {
        this.report(DiagnosticCode.UnterminatedString, "unterminated raw string", line, column, this.column);
        return stripCommonIndent(this.source.slice(start, this.pos));
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --conditions=development --test src/parse/tests/lexer-recovery.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Confirm no regression**

Run: `tsx --conditions=development --test src/parse/tests/lexer-span.test.ts src/parse/tests/parser.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parse/lexer.ts src/parse/tests/lexer-recovery.test.ts
git commit -m "feat(lexer): recover from bad chars/unterminated strings as diagnostics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: AST node spans

**Files:**
- Modify: `src/parse/ast.ts` (add `span` to node types)
- Modify: `src/parse/parser.ts` (thread `uri`; stamp spans on declarations, instances, assignments)
- Test: `src/parse/tests/ast-span.test.ts`

**Interfaces:**
- Consumes: `SourceSpan`, `tokenSpan` (Task 1); `Token.endLine/endColumn` (Task 2).
- Produces: `NamespaceNode`, each `Declaration` variant, and `AssignmentNode` carry `span: SourceSpan`.

This task keeps `parse`'s existing throwing signature (`parse(source): NamespaceNode`) — recovery arrives in Task 5. It threads a `uri` through the parser with a default so existing callers are unaffected.

- [ ] **Step 1: Write the failing test**

`src/parse/tests/ast-span.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

test("a concept declaration carries a source span", () => {
  const ns = parse(fixture("concepts.todl"), "concepts.todl");
  const concept = ns.declarations.find((d) => d.kind === DeclKind.Concept);
  assert.ok(concept);
  assert.equal(concept!.span.uri, "concepts.todl");
  assert.ok(concept!.span.start.line >= 1);
  assert.ok(concept!.span.end.line >= concept!.span.start.line);
});

test("an instance assignment carries its own span", () => {
  const ns = parse(fixture("order-fulfillment.todl"), "order-fulfillment.todl");
  const instance = ns.declarations.find((d) => d.kind === DeclKind.Instance);
  assert.ok(instance && instance.kind === DeclKind.Instance);
  const assignment = instance.assignments[0];
  assert.ok(assignment?.span);
  assert.equal(assignment!.span.uri, "order-fulfillment.todl");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --conditions=development --test src/parse/tests/ast-span.test.ts`
Expected: FAIL — `parse` takes one arg / nodes have no `span`.

- [ ] **Step 3: Add `span` to the AST node types**

In `src/parse/ast.ts`, add `import type { SourceSpan } from "../diagnostics/span.js";` and add `span: SourceSpan;` to: `NamespaceNode`, `InstanceDecl`, `ConceptDecl`, `EnumDecl`, `PrimitiveDecl`, and `AssignmentNode`. (Leaving `FieldDecl`/`RelationshipDecl`/`InvariantDecl`/`EnumCase` unspanned is fine for v1 — validation diagnostics resolve to instances and their assignments, which are spanned.)

- [ ] **Step 4: Thread `uri` and stamp spans in the parser**

In `src/parse/parser.ts`:
```ts
export function parse(source: string, uri = "<anonymous>"): NamespaceNode {
  return new Parser(tokenize(source), uri).parseNamespace();
}
```
Add `uri` to the constructor: `constructor(private readonly tokens: Token[], private readonly uri: string) {}`.

Add a span helper that captures from a start token to the token just consumed:
```ts
  /** The token at the cursor (the next unconsumed token). */
  private startToken(): Token {
    return this.current();
  }

  /** Span from `start` through the last consumed token (the one before the cursor). */
  private spanFrom(start: Token): SourceSpan {
    const prevIndex = this.pos > 0 ? this.pos - 1 : 0;
    const last = this.tokens[prevIndex] ?? start;
    return {
      uri: this.uri,
      start: { line: start.line, column: start.column },
      end: { line: last.endLine, column: last.endColumn },
    };
  }
```
Import `type { SourceSpan }` from `../diagnostics/span.js`.

At the top of each declaration parse method, capture `const start = this.startToken();` before consuming, and set `span: this.spanFrom(start)` on the returned node. Concretely, in `parseNamespace`, `parsePrimitive`, `parseEnum`, `parseConcept`, `parseInstanceFrom`, add the `span` field to the returned object literals. For `parseInstanceFrom`, capture `start` in `parseInstance`/`parseDeclaration` before the leading identifier is consumed and pass it in, or re-capture at the method entry using the concept identifier's position — simplest is to capture `start` as the first token of the declaration in `parseDeclaration` and thread it. Pattern for `parseConcept` (others mirror it):
```ts
  private parseConcept(): ConceptDecl {
    const start = this.startToken();
    this.expectKeyword("concept");
    // …existing parsing…
    return { kind: DeclKind.Concept, name, extends: ext, description, fields, relationships, invariants, span: this.spanFrom(start) };
  }
```
For `AssignmentNode`, in the assignment-parsing method capture the start token before the member name and set `span` on the returned `{ name, value, span }`.

For nested instance `children`, each child is produced by `parseInstanceFrom`, so it is spanned by the same code path.

- [ ] **Step 5: Run test to verify it passes**

Run: `tsx --conditions=development --test src/parse/tests/ast-span.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Confirm existing parser tests still pass**

Run: `tsx --conditions=development --test src/parse/tests/parser.test.ts src/parse/tests/loader.test.ts`
Expected: PASS — existing callers use `parse(fixture)` (uri defaults) and read `.declarations`; the added `span` fields don't affect their assertions.

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/ast-span.test.ts
git commit -m "feat(parser): stamp source spans on declarations, instances, assignments

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Parser recovery + `ParseResult` + `parse(text, uri)`

**Files:**
- Modify: `src/parse/parser.ts` (`ParseError`, recover at declaration boundary, `synchronize`, new `parse` signature)
- Modify: `src/parse/tests/parser.test.ts`, `src/parse/tests/predicate-parser.test.ts`, `src/parse/tests/ast-span.test.ts` (call-site migration)
- Test: `src/parse/tests/parser-recovery.test.ts`

**Interfaces:**
- Consumes: `lex` (Task 3), `tokenSpan` (Task 1), spanned AST (Task 4).
- Produces: `interface ParseResult { namespace: NamespaceNode; diagnostics: Diagnostic[] }`; `parse(text: string, uri: string): ParseResult`.

This changes `parse`'s return type, so its in-repo callers migrate in this task (they read `.namespace`).

- [ ] **Step 1: Write the failing test**

`src/parse/tests/parser-recovery.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const SRC = `namespace demo {
  concept good-a { label : string; }
  concept @@@ { }                       // broken declaration
  concept good-b { label : string; }
}`;

test("parse recovers past a broken declaration and reports it", () => {
  const { namespace, diagnostics } = parse(SRC, "demo.todl");
  // Both well-formed concepts survived recovery.
  const names = namespace.declarations
    .filter((d) => d.kind === DeclKind.Concept)
    .map((d) => (d.kind === DeclKind.Concept ? d.name : ""));
  assert.deepEqual(names, ["good-a", "good-b"]);
  // The broken one produced at least one spanned syntax diagnostic.
  assert.ok(diagnostics.length >= 1);
  assert.ok(diagnostics[0]?.span?.uri === "demo.todl");
  assert.ok(diagnostics[0]?.code.startsWith("syntax."));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --conditions=development --test src/parse/tests/parser-recovery.test.ts`
Expected: FAIL — `parse` returns a `NamespaceNode` (no `.diagnostics`) and today throws on `@@@`.

- [ ] **Step 3: Add `ParseError` and make `this.error` throw it**

In `src/parse/parser.ts`:
```ts
import { type Diagnostic, DiagnosticCode, Severity } from "../diagnostics/diagnostic.js";
import { lex } from "./lexer.js";
import { tokenSpan } from "../diagnostics/span.js";

class ParseError extends Error {
  constructor(message: string, readonly token: Token) {
    super(message);
  }
}
```
Change `error()` to build a `ParseError` carrying the offending token:
```ts
  private error(message: string): ParseError {
    const token = this.current();
    const got = token.value.length > 0 ? token.value : token.kind;
    return new ParseError(`${message} (got "${got}")`, token);
  }
```
(The `expect*` helpers already do `throw this.error(...)`; they now throw a `ParseError`.)

- [ ] **Step 4: Recover in the declaration loop + `synchronize`**

Give the parser a diagnostics list seeded from the lexer, and wrap `parseDeclaration()` in try/catch inside `parseNamespace`. Replace the `parse` entry and `parseNamespace`'s loop:
```ts
export interface ParseResult { namespace: NamespaceNode; diagnostics: Diagnostic[] }

export function parse(source: string, uri = "<anonymous>"): ParseResult {
  const { tokens, diagnostics } = lex(source, uri);
  return new Parser(tokens, uri, diagnostics).parse();
}
```
Constructor takes the seeded diagnostics:
```ts
  constructor(
    private readonly tokens: Token[],
    private readonly uri: string,
    private readonly diagnostics: Diagnostic[],
  ) {}

  parse(): ParseResult {
    const namespace = this.parseNamespace();
    return { namespace, diagnostics: this.diagnostics };
  }
```
In `parseNamespace`, wrap the declaration loop:
```ts
    const declarations: Declaration[] = [];
    while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
      const before = this.pos;
      try {
        declarations.push(this.parseDeclaration());
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        this.diagnostics.push({
          code: DiagnosticCode.UnexpectedToken,
          severity: Severity.Error,
          message: err.message,
          span: tokenSpan(err.token, this.uri),
          node: null,
          path: null,
        });
        this.synchronize();
        if (this.pos === before) this.advance(); // guarantee forward progress
      }
    }
```
Add `synchronize()` after the cursor helpers — skip to the next declaration boundary:
```ts
  /** Skip tokens until the start of the next declaration, a closing brace, or EOF. */
  private synchronize(): void {
    while (!this.check(TokenKind.EOF)) {
      if (this.check(TokenKind.RBrace)) return;
      if (
        this.checkKeyword("primitive") ||
        this.checkKeyword("enum") ||
        this.checkKeyword("concept") ||
        this.checkKeyword("internal") ||
        this.checkKeyword("sealed") ||
        this.checkKeyword("application-connectors")
      ) {
        return;
      }
      this.advance();
    }
  }
```
Update the module-level `EOF_TOKEN` literal to include the new fields:
```ts
const EOF_TOKEN: Token = { kind: TokenKind.EOF, value: "", line: 0, column: 0, endLine: 0, endColumn: 0 };
```

- [ ] **Step 5: Run the recovery test**

Run: `tsx --conditions=development --test src/parse/tests/parser-recovery.test.ts`
Expected: PASS. (Recovery may emit one or more diagnostics for `@@@`; the test asserts `>= 1` and that both good concepts survive. If `good-b` is missing, widen `synchronize` — but with the concept keyword as a sync point it resyncs correctly.)

- [ ] **Step 6: Migrate `parse` call sites**

`parse(...)` now returns `ParseResult`. Update the in-repo callers to read `.namespace`:
- `src/parse/tests/parser.test.ts` — every `parse(fixture("x.todl"))` → `parse(fixture("x.todl"), "x.todl").namespace`.
- `src/parse/tests/predicate-parser.test.ts` — same transform (add a uri, append `.namespace`).
- `src/parse/tests/ast-span.test.ts` (Task 4) — same transform.
- `src/parse/loader.ts` — line 29 becomes (interim, fully replaced in Task 7): `const declarations = sources.flatMap((source) => parse(source, "<anonymous>").namespace.declarations);`

- [ ] **Step 7: Run the full parse + loader test suite**

Run: `tsx --conditions=development --test src/parse/tests/parser.test.ts src/parse/tests/predicate-parser.test.ts src/parse/tests/loader.test.ts src/parse/tests/ast-span.test.ts src/parse/tests/parser-recovery.test.ts`
Expected: PASS across all.

- [ ] **Step 8: Commit**

```bash
git add src/parse/parser.ts src/parse/loader.ts src/parse/tests/
git commit -m "feat(parser): error recovery + ParseResult; parse(text,uri) returns diagnostics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Model span store

**Files:**
- Modify: `src/model/model.ts` (span map + `recordSpan`/`spanOf`/`memberKey`)
- Test: `src/model/tests/model-span.test.ts`

**Interfaces:**
- Consumes: `SourceSpan` (Task 1).
- Produces: `Model.recordSpan(key: string, span: SourceSpan): void`, `Model.spanOf(key: string): SourceSpan | null`, static `Model.memberKey(node: NodeId, member: string): string`.

- [ ] **Step 1: Write the failing test**

`src/model/tests/model-span.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../model.js";
import type { SourceSpan } from "../../diagnostics/span.js";

const span = (uri: string): SourceSpan => ({ uri, start: { line: 2, column: 1 }, end: { line: 2, column: 8 } });

test("records and resolves a node span, and a member-qualified span", () => {
  const model = new Model();
  model.recordSpan("teams-chat", span("a.todl"));
  model.recordSpan(Model.memberKey("teams-chat", "label"), span("b.todl"));

  assert.equal(model.spanOf("teams-chat")?.uri, "a.todl");
  assert.equal(model.spanOf(Model.memberKey("teams-chat", "label"))?.uri, "b.todl");
  assert.equal(model.spanOf("missing"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --conditions=development --test src/model/tests/model-span.test.ts`
Expected: FAIL — no `recordSpan`/`spanOf`/`memberKey`.

- [ ] **Step 3: Implement the span store**

In `src/model/model.ts`, add `import type { SourceSpan } from "../diagnostics/span.js";`, a private field, and the methods:
```ts
  private readonly spans = new Map<string, SourceSpan>();

  /** Record the defining source span for a node id or a member key. */
  recordSpan(key: string, span: SourceSpan): void {
    this.spans.set(key, span);
  }

  /** The span recorded for a node id or member key, or null. */
  spanOf(key: string): SourceSpan | null {
    return this.spans.get(key) ?? null;
  }

  /** Composite key for a per-instance member span. */
  static memberKey(node: NodeId, member: string): string {
    return `${node}#${member}`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --conditions=development --test src/model/tests/model-span.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/model.ts src/model/tests/model-span.test.ts
git commit -m "feat(model): source-span store (recordSpan/spanOf/memberKey)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `load(SourceFile[])` → `LoadResult` + record spans

**Files:**
- Modify: `src/parse/loader.ts` (`SourceFile[]` input; record decl/instance/assignment spans; return `LoadResult`)
- Modify: `src/parse/tests/loader.test.ts`, `src/emit/tests/js-module.test.ts`, `src/migrate/tests/faithfulness.test.ts`, `src/migrate/tests/model.test.ts` (call-site migration)
- Test: `src/parse/tests/loader-span.test.ts`

**Interfaces:**
- Consumes: `SourceFile` (Task 1), `parse(text, uri): ParseResult` (Task 5), `Model.recordSpan`/`memberKey` (Task 6), spanned AST (Task 4).
- Produces: `interface LoadResult { model: Model; diagnostics: Diagnostic[] }`; `load(sources: SourceFile[]): LoadResult`.

- [ ] **Step 1: Write the failing test**

`src/parse/tests/loader-span.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { Model } from "../../model/model.js";

const CONCEPTS = `namespace ea {
  concept component { label : string; }
}`;
const MODEL = `namespace app {
  component teams-chat { label = "Teams"; }
}`;

test("load takes SourceFiles, builds a model, and records instance spans", () => {
  const { model, diagnostics } = load([
    { uri: "concepts.todl", text: CONCEPTS },
    { uri: "app.todl", text: MODEL },
  ]);
  assert.equal(diagnostics.length, 0);
  assert.ok(model.has("teams-chat"));
  assert.equal(model.spanOf("teams-chat")?.uri, "app.todl");
  assert.equal(model.spanOf(Model.memberKey("teams-chat", "label"))?.uri, "app.todl");
});

test("load surfaces syntax diagnostics from a malformed file", () => {
  const { diagnostics } = load([{ uri: "bad.todl", text: "namespace x { concept @@@ { } }" }]);
  assert.ok(diagnostics.some((d) => d.span?.uri === "bad.todl"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --conditions=development --test src/parse/tests/loader-span.test.ts`
Expected: FAIL — `load` takes `string[]` and returns a `Model`.

- [ ] **Step 3: Rewrite `load` to consume `SourceFile[]` and record spans**

In `src/parse/loader.ts`:
```ts
import { parse } from "./parser.js";
import { Model } from "../model/model.js";
import type { SourceFile } from "../diagnostics/span.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { DeclKind, /* … existing … */ } from "./ast.js";

export interface LoadResult { model: Model; diagnostics: Diagnostic[] }

export function load(sources: SourceFile[]): LoadResult {
  const diagnostics: Diagnostic[] = [];
  const declarations = sources.flatMap((source) => {
    const result = parse(source.text, source.uri);
    diagnostics.push(...result.diagnostics);
    return result.namespace.declarations;
  });

  const model = new Model();
  // … existing pass 1 / pass 2 build over `declarations`, unchanged …
  recordSpans(model, declarations);
  return { model, diagnostics };
}
```
Add a `recordSpans` pass that stores each declaration's, instance's, and assignment's span. Instances are recursive (children), and instance assignments key off `Model.memberKey(instanceId, name)`:
```ts
function recordSpans(model: Model, declarations: Declaration[]): void {
  for (const declaration of declarations) {
    switch (declaration.kind) {
      case DeclKind.Primitive:
      case DeclKind.Enum:
      case DeclKind.Concept:
        model.recordSpan(declaration.name, declaration.span);
        break;
      case DeclKind.Instance:
        recordInstanceSpans(model, declaration);
        break;
    }
  }
}

function recordInstanceSpans(model: Model, decl: InstanceDecl): void {
  model.recordSpan(decl.id, decl.span);
  for (const assignment of decl.assignments) {
    model.recordSpan(Model.memberKey(decl.id, assignment.name), assignment.span);
  }
  for (const child of decl.children) recordInstanceSpans(model, child);
}
```
(Keep the existing pass-1/pass-2 body exactly as it is; only the input shape, the parse call, the return type, and the added `recordSpans` are new. `WRAPPER_CONCEPTS` transparent wrappers still record the wrapper id's span — harmless; its children also record their own.)

- [ ] **Step 4: Run the loader-span test**

Run: `tsx --conditions=development --test src/parse/tests/loader-span.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Migrate `load` call sites**

`load(string[]): Model` → `load(SourceFile[]): LoadResult`. Update callers to wrap sources as `{ uri, text }` and read `.model`:
- `src/parse/tests/loader.test.ts` — `load([textA, textB])` → `load([{ uri: "a.todl", text: textA }, { uri: "b.todl", text: textB }]).model`.
- `src/emit/tests/js-module.test.ts`, `src/migrate/tests/faithfulness.test.ts`, `src/migrate/tests/model.test.ts` — same transform (wrap each source string with a synthetic uri like the fixture filename; read `.model`).

Search first to catch every caller:
```bash
grep -rn "\bload(" src --include=*.ts | grep -v "function load\|loadFrom\|download"
```
Update each hit.

- [ ] **Step 6: Run the affected suites**

Run: `tsx --conditions=development --test src/parse/tests/loader.test.ts src/parse/tests/loader-span.test.ts src/emit/tests/js-module.test.ts src/migrate/tests/faithfulness.test.ts src/migrate/tests/model.test.ts`
Expected: PASS across all.

- [ ] **Step 7: Commit**

```bash
git add src/parse/loader.ts src/parse/tests/loader-span.test.ts src/parse/tests/loader.test.ts src/emit/tests/js-module.test.ts src/migrate/tests/
git commit -m "feat(loader): SourceFile[] input, LoadResult with diagnostics, model spans

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `validate()` span enrichment

**Files:**
- Modify: `src/validate/validate.ts` (re-export diagnostic types from `diagnostics/`; attach spans)
- Test: `src/validate/tests/validate-span.test.ts`

**Interfaces:**
- Consumes: `Model.spanOf`/`memberKey` (Task 6); `Diagnostic`/`DiagnosticCode`/`Severity` (Task 1).
- Produces: `validate(model)` returns diagnostics whose `span` is the offending instance's member span (if recorded) else its node span, else `null`.

- [ ] **Step 1: Write the failing test**

`src/validate/tests/validate-span.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../../parse/loader.js";
import { validate } from "../validate.js";

// `label` is required (cardinality One) but missing → a diagnostic on the instance.
const CONCEPTS = `namespace ea { concept component { label : string; } }`;
const MODEL = `namespace app { component teams-chat { } }`;

test("a required-missing diagnostic carries the instance's span", () => {
  const { model } = load([
    { uri: "c.todl", text: CONCEPTS },
    { uri: "app.todl", text: MODEL },
  ]);
  const diagnostics = validate(model);
  const missing = diagnostics.find((d) => d.path === "component.label");
  assert.ok(missing);
  assert.equal(missing!.span?.uri, "app.todl"); // resolved to the instance declaration
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --conditions=development --test src/validate/tests/validate-span.test.ts`
Expected: FAIL — diagnostics have no `span` (property is `undefined`).

- [ ] **Step 3: Re-export the shared types and enrich spans**

In `src/validate/validate.ts`, delete the local `Severity`/`DiagnosticCode`/`Diagnostic` definitions and re-export from the shared module:
```ts
export { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";
```
Add a span resolver — prefer the instance's per-member span, else the instance node span:
```ts
function spanFor(model: Model, node: NodeId, member: string | null): SourceSpan | null {
  if (member !== null) {
    const memberSpan = model.spanOf(Model.memberKey(node, member));
    if (memberSpan !== null) return memberSpan;
  }
  return model.spanOf(node);
}
```
Import `type { SourceSpan }` from `../diagnostics/span.js`. Then set `span` on every emitted diagnostic. The `error(...)` helper and the two inline `out.push({...})` sites (target-type, invariant) all have `node` and a member in scope:
- `checkCardinality` → `error(code, node.id, path, msg)` becomes span-aware; pass the bare `member` (already a param) so `spanFor(model, node.id, member)` resolves. Thread `model` + `member` into `error`, or inline the span at each push. Simplest: change `error` to accept an explicit span and compute it at each call site where `model`, `node`, and `member` are in scope. In `checkCardinality`, `checkTargetTypes` (member = `relationship.name`), and `checkInvariants` (member = `null`; span resolves to the instance node).
```ts
function error(code: DiagnosticCode, node: NodeId, path: string, message: string, span: SourceSpan | null): Diagnostic {
  return { code, severity: Severity.Error, node, path, message, span };
}
```
Update `checkCardinality`'s signature to also receive `model` (it currently doesn't) so it can call `spanFor(model, node.id, member)`; the call in `validate()` passes `model`. For the two inline `out.push` sites, add `span: spanFor(model, node.id, relationship.name)` / `span: spanFor(model, node.id, null)` respectively.

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --conditions=development --test src/validate/tests/validate-span.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the existing validate suite still passes**

Run: `tsx --conditions=development --test src/validate/tests/*.test.ts`
Expected: PASS — existing assertions read `code`/`node`/`path`/`message`, all unchanged; `span` is additive.

- [ ] **Step 6: Commit**

```bash
git add src/validate/validate.ts src/validate/tests/validate-span.test.ts
git commit -m "feat(validate): attach source spans to semantic diagnostics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `check()` + index exports

**Files:**
- Create: `src/api.ts`
- Modify: `src/index.ts`
- Test: `src/tests/check.test.ts`

**Interfaces:**
- Consumes: `load` (Task 7), `validate` (Task 8).
- Produces: `check(sources: SourceFile[]): { model: Model; diagnostics: Diagnostic[] }`.

- [ ] **Step 1: Write the failing test**

`src/tests/check.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../api.js";

const CONCEPTS = `namespace ea { concept component { label : string; } }`;
// One syntax error (in bad.todl) + one semantic error (missing required label).
const BAD = `namespace app { component teams-chat { } component @@@ { } }`;

test("check returns syntax + semantic diagnostics, partitionable by uri", () => {
  const { diagnostics } = check([
    { uri: "c.todl", text: CONCEPTS },
    { uri: "bad.todl", text: BAD },
  ]);
  assert.ok(diagnostics.length >= 2);
  assert.ok(diagnostics.every((d) => d.span === null || typeof d.span.uri === "string"));
  const byUri = diagnostics.filter((d) => d.span?.uri === "bad.todl");
  assert.ok(byUri.some((d) => d.code.startsWith("syntax.")));
  assert.ok(byUri.some((d) => d.code.startsWith("cardinality.")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --conditions=development --test src/tests/check.test.ts`
Expected: FAIL — no `../api.js`.

- [ ] **Step 3: Implement `check` and export it**

`src/api.ts`:
```ts
import { load } from "./parse/loader.js";
import { validate } from "./validate/validate.js";
import type { SourceFile } from "./diagnostics/span.js";
import type { Diagnostic } from "./diagnostics/diagnostic.js";
import type { Model } from "./model/model.js";

/** Load the sources and validate the result; every diagnostic is spanned. */
export function check(sources: SourceFile[]): { model: Model; diagnostics: Diagnostic[] } {
  const { model, diagnostics } = load(sources);
  return { model, diagnostics: [...diagnostics, ...validate(model)] };
}
```
In `src/index.ts`, add exports:
```ts
export { check } from "./api.js";
export { load, type LoadResult } from "./parse/loader.js";
export { parse, type ParseResult } from "./parse/parser.js";
export type { Position, SourceSpan, SourceFile } from "./diagnostics/span.js";
export { Severity, DiagnosticCode, type Diagnostic } from "./diagnostics/diagnostic.js";
```
Remove any now-duplicated `Severity`/`DiagnosticCode`/`Diagnostic` re-export that previously came from `./validate/validate.js` (they now come from `./diagnostics/diagnostic.js`; the `validate` function export stays).

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --conditions=development --test src/tests/check.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — all files green (new + migrated). If a stray `load(`/`parse(` caller remains, TypeScript-level failures surface here; fix per Tasks 5/7 transforms.

- [ ] **Step 6: Commit**

```bash
git add src/api.ts src/index.ts src/tests/check.test.ts
git commit -m "feat(api): check() load+validate; export spans, SourceFile, ParseResult, LoadResult

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Publish `@pragmatic-lab/todl` to Verdaccio

**Files:**
- Modify: `package.json` (version bump)

**Interfaces:**
- Consumes: the whole build.

- [ ] **Step 1: Confirm the build is clean**

Run: `npm run build` (or the repo's build script; check `package.json` `scripts`).
Expected: type-checks and emits `dist/` with no errors. If `check`/`load`/`parse`/span types aren't in `dist/index.d.ts`, fix the `src/index.ts` exports (Task 9) before publishing.

- [ ] **Step 2: Bump the version**

In `package.json`, set `"version": "0.1.0"` (was `0.0.1`).

- [ ] **Step 3: Confirm Verdaccio is reachable**

Run: `curl -s http://localhost:4873/-/ping && echo OK`
Expected: `OK` (start Verdaccio if not — same registry Plexus uses). If auth is required, ensure the existing `.npmrc`/registry token is present (do not commit tokens).

- [ ] **Step 4: Publish**

Run: `npm publish --registry http://localhost:4873`
Expected: `+ @pragmatic-lab/todl@0.1.0`.

- [ ] **Step 5: Verify the published package resolves**

Run: `curl -s http://localhost:4873/@pragmatic-lab%2ftodl | grep -o '"version":"0.1.0"' | head -1`
Expected: `"version":"0.1.0"`.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "chore: publish @pragmatic-lab/todl 0.1.0 (spans, recovery, check)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 Span & unified diagnostic types → Task 1. ✓
- §2 Spans through the pipeline (lexer end → AST → Model → validator) → Tasks 2, 4, 6, 7, 8. ✓
- §3 File attribution + recovery (`SourceFile`, `parse→ParseResult`, `load→LoadResult`, `synchronize`) → Tasks 3, 5, 7. ✓
- §3 `check()` → Task 9. ✓
- §4 Publish → Task 10. ✓
- Testing bullets (span accuracy, recovery, semantic span mapping, `check` end-to-end) → Tasks 2, 5, 8, 9. ✓
- Affected-surface list (lexer, ast, parser, model, loader, validate, index, package.json, callers/tests) → all touched. ✓

**Resolved open decision (from the spec):** end position is **stored on `Token`**, not derived — a string token's decoded `value` differs from its source length, and raw strings span lines, so `value.length` is wrong. `check()` lives in its own `src/api.ts` (validate.ts stays pure semantic logic), matching the spec's recommendation.

**Placeholder scan:** No TBD/TODO; every code step shows real code; test steps show real assertions.

**Type consistency:** `SourceSpan`/`Position`/`SourceFile` (Task 1) used identically in 2/4/6/7/8/9; `ParseResult`/`LoadResult` field names (`namespace`/`model` + `diagnostics`) consistent across 5/7/9; `Model.memberKey`/`spanOf`/`recordSpan` names identical in 6/7/8; `DiagnosticCode` syntax members (`syntax.*`) referenced consistently in 3/5/9.

**Migration completeness:** `parse` callers migrated in Task 5 (parser/predicate/ast-span tests + loader interim); `load` callers migrated in Task 7 (loader/emit/migrate tests) with a `grep` sweep to catch stragglers; a final `npm test` in Task 9 is the backstop.
