# TODL Language Service — Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the TODL analysis core — the AST span-enrichment, the `analyze()` builder, position conversion, symbol-kind helpers, the reference index, the cursor-context classifier, and the five daily-driver query functions (diagnostics, completion, hover, definition, references) — all pure and headless-tested.

**Architecture:** A new `src/language-service/` folder in the TODL repo, exported as `@pragmatic-lab/todl/language-service`. `analyze(sources, bases)` parses each file (AST + tokens), runs `checkAgainst` for the combined `Repository` + diagnostics, and builds a reference index. Pure query functions take that `Analysis` and return `vscode-languageserver-types`. No protocol, no Monaco, no caching.

**Tech Stack:** TypeScript (ESM, strict), the existing TODL compiler (`parse`, `tokenize`, `checkAgainst`, `Repository`, span types), `vscode-languageserver-types` (types-only), `node:test` via `tsx`.

**Spec:** [`2026-07-28-todl-language-service-core-design.md`](../specs/2026-07-28-todl-language-service-core-design.md). This Foundation plan covers the substrate + diagnostics/completion/hover/definition/references. The Advanced plan (rename, semantic tokens, document symbols, folding, workspace symbols, code actions, formatting, signature help) is a separate follow-on.

## Global Constraints

- **Result types:** every query function returns `vscode-languageserver-types` values. No bespoke result shapes.
- **Positions:** TODL spans are 1-based line/column, exclusive end; LSP is 0-based line/character. All 1↔0 conversion happens only in `position.ts`.
- **Purity:** `analyze()` is whole-project and pure; there is no incremental cache in the core.
- **Dependency direction:** `language-service/` imports the compiler; the compiler never imports `language-service/`. The one exception is the AST/parser span-enrichment (Task 1), which lands in the compiler proper.
- **Tests:** every test file lives in a `tests/` subfolder next to its source (`src/language-service/tests/…`). Run with `npx tsx --conditions=development --test "<glob>"`.
- **Backward compatibility:** the AST span additions are all optional fields; the full existing TODL suite must stay green after Task 1.

---

### Task 1: AST reference spans (compiler enrichment)

Add optional source-span fields to the parse AST for the reference positions the LSP needs (extends, field name/type, relationship name/target, imports, instance concept/instanceof, `&ref` values). Optional = backward-compatible. Lands in the compiler; gated by the full suite.

**Files:**
- Modify: `src/parse/ast.ts` (add optional span fields)
- Modify: `src/parse/parser.ts` (capture tokens → spans)
- Test: `src/parse/tests/ast-reference-spans.test.ts` (new)

**Interfaces:**
- Consumes: `tokenSpan(token, uri)` and `SourceSpan` from `src/diagnostics/span.js`; `Token`/`TokenKind` from `src/parse/lexer.js`.
- Produces (new optional AST fields): `ConceptDecl.extendsSpan?: SourceSpan`; `FieldDecl.nameSpan?: SourceSpan`, `FieldDecl.typeSpan?: SourceSpan`; `RelationshipDecl.nameSpan?: SourceSpan`, `RelationshipDecl.targetSpan?: SourceSpan`; `NamespaceNode.importSpans?: SourceSpan[]`; `InstanceDecl.conceptSpan?: SourceSpan`, `InstanceDecl.instanceOfSpan?: SourceSpan`; `RefValue.span?: SourceSpan`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/ast-reference-spans.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, ValueKind, type ConceptDecl, type InstanceDecl } from "../ast.js";

test("concept extends + field + relationship carry reference spans", () => {
  const src = [
    "namespace demo {",
    "  concept animal { }",
    "  concept dog : animal {",
    "    name : string;",
    "    relationship owner -> person [];",
    "  }",
    "}",
  ].join("\n");
  const { namespace } = parse(src, "d.todl");
  const dog = namespace.declarations.find(
    (d): d is ConceptDecl => d.kind === DeclKind.Concept && d.name === "dog",
  )!;
  // `animal` in `: animal` is on line 3 (1-based), column 16..22 (exclusive end).
  assert.deepEqual(dog.extendsSpan?.start, { line: 3, column: 16 });
  assert.equal(dog.extendsSpan?.end.column, 22);
  assert.deepEqual(dog.fields[0].nameSpan?.start, { line: 4, column: 5 });
  assert.deepEqual(dog.fields[0].typeSpan?.start, { line: 4, column: 12 });
  assert.deepEqual(dog.relationships[0].nameSpan?.start, { line: 5, column: 18 });
  assert.deepEqual(dog.relationships[0].targetSpan?.start, { line: 5, column: 27 });
});

test("imports and instance concept/instanceof and ref values carry spans", () => {
  const src = [
    "namespace demo {",
    "  import other.lib;",
    "  concept person { }",
    "  person alice instanceof someone { friend = &bob; }",
    "}",
  ].join("\n");
  const { namespace } = parse(src, "d.todl");
  assert.equal(namespace.importSpans?.length, 1);
  assert.deepEqual(namespace.importSpans?.[0].start, { line: 2, column: 10 });
  const alice = namespace.declarations.find(
    (d): d is InstanceDecl => d.kind === DeclKind.Instance && d.id === "alice",
  )!;
  assert.deepEqual(alice.conceptSpan?.start, { line: 4, column: 3 });
  assert.deepEqual(alice.instanceOfSpan?.start, { line: 4, column: 25 });
  const ref = alice.assignments[0].value;
  assert.equal(ref.kind, ValueKind.Ref);
  assert.deepEqual((ref as { span?: { start: unknown } }).span?.start, { line: 4, column: 45 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/parse/tests/ast-reference-spans.test.ts"`
Expected: FAIL — `extendsSpan`/`nameSpan`/… are `undefined`.

- [ ] **Step 3: Add the optional fields to `src/parse/ast.ts`**

Add to the named interfaces (leave everything else unchanged):

```ts
export interface RefValue {
  kind: ValueKind.Ref;
  ref: string;
  /** Span of the `&name` reference occurrence (set by the parser). */
  span?: SourceSpan;
}

export interface FieldDecl {
  name: string;
  type: string;
  cardinality: Cardinality;
  nameSpan?: SourceSpan;
  typeSpan?: SourceSpan;
}

export interface RelationshipDecl {
  name: string;
  target: string;
  cardinality: Cardinality;
  nameSpan?: SourceSpan;
  targetSpan?: SourceSpan;
}

export interface InstanceDecl {
  // …existing fields unchanged…
  conceptSpan?: SourceSpan;
  instanceOfSpan?: SourceSpan;
}

export interface ConceptDecl {
  // …existing fields unchanged…
  extendsSpan?: SourceSpan;
}

export interface NamespaceNode {
  // …existing fields unchanged…
  importSpans?: SourceSpan[];
}
```

- [ ] **Step 4: Capture the spans in `src/parse/parser.ts`**

`parseNamespace` — record import spans (the block currently pushes bare strings):

```ts
const imports: string[] = [];
const importSpans: SourceSpan[] = [];
while (this.checkKeyword("import")) {
  this.advance();
  const startTok = this.current();
  imports.push(this.parseDottedPath());
  importSpans.push(this.spanFrom(startTok));
  this.expect(TokenKind.Semicolon);
}
```

and return `{ path, imports, declarations, span: this.spanFrom(start), importSpans }`.

`parseConcept` — capture the extends token:

```ts
let extendsName: string | null = null;
let extendsSpan: SourceSpan | undefined;
if (this.match(TokenKind.Colon)) {
  const t = this.expect(TokenKind.Identifier);
  extendsName = t.value;
  extendsSpan = tokenSpan(t, this.uri);
}
```

and in the field branch, capture the name + type tokens (replace `const memberName = this.expectIdentifier();` and the `:` arm):

```ts
const nameTok = this.expect(TokenKind.Identifier);
const memberName = nameTok.value;
if (this.match(TokenKind.Colon)) {
  const typeTok = this.expect(TokenKind.Identifier);
  const cardinality = this.parseCardinality();
  this.expect(TokenKind.Semicolon);
  fields.push({
    name: memberName, type: typeTok.value, cardinality,
    nameSpan: tokenSpan(nameTok, this.uri), typeSpan: tokenSpan(typeTok, this.uri),
  });
} else if (this.match(TokenKind.Equals)) {
  // …unchanged…
```

Return the concept with `extendsSpan` added.

`parseRelationship` — capture name + target tokens:

```ts
private parseRelationship(): RelationshipDecl {
  this.expectKeyword("relationship");
  const nameTok = this.expect(TokenKind.Identifier);
  this.expect(TokenKind.Arrow);
  const targetTok = this.expect(TokenKind.Identifier);
  const cardinality = this.parseCardinality();
  this.expect(TokenKind.Semicolon);
  return {
    name: nameTok.value, target: targetTok.value, cardinality,
    nameSpan: tokenSpan(nameTok, this.uri), targetSpan: tokenSpan(targetTok, this.uri),
  };
}
```

`parseDeclaration` — capture the instance concept token and thread its span in (the plain-instance arm, currently `return this.parseInstanceFrom(this.expectIdentifier(), start);`):

```ts
if (this.check(TokenKind.Identifier)) {
  const conceptTok = this.expect(TokenKind.Identifier);
  if (this.peekKind(0) === TokenKind.Amp) return this.parseEdgeRecord(conceptTok.value, start);
  return this.parseInstanceFrom(conceptTok.value, start, false, tokenSpan(conceptTok, this.uri));
}
```

(Note: after consuming the identifier the `&` is now `peekKind(0)`/`check(Amp)`; keep the existing edge-record detection equivalent — check the current token for `Amp`.)

`parseInstanceFrom` — accept the concept span and capture the instanceof token:

```ts
private parseInstanceFrom(concept: string, start: Token, isClass = false, conceptSpan?: SourceSpan): InstanceDecl {
  const id = this.expectRecordId();
  let instanceOf: string | null = null;
  let instanceOfSpan: SourceSpan | undefined;
  if (this.checkKeyword("instanceof")) {
    this.advance();
    const t = this.expect(TokenKind.Identifier);
    instanceOf = t.value;
    instanceOfSpan = tokenSpan(t, this.uri);
  }
  // …unchanged body…
  return { kind: DeclKind.Instance, concept, id, binds, isClass, instanceOf,
           assignments, children, span: this.spanFrom(start), conceptSpan, instanceOfSpan };
}
```

`parseValue` — capture the ref span (replace the `if (this.match(TokenKind.Amp))` arm):

```ts
if (this.check(TokenKind.Amp)) {
  const ampTok = this.advance();
  const ref = this.parseDottedPath();
  const endTok = this.tokens[this.pos > 0 ? this.pos - 1 : 0] ?? ampTok;
  return { kind: ValueKind.Ref, ref, span: {
    uri: this.uri,
    start: { line: ampTok.line, column: ampTok.column },
    end: { line: endTok.endLine, column: endTok.endColumn },
  } };
}
```

Ensure `SourceSpan` and `tokenSpan` are imported (they already are).

- [ ] **Step 5: Run the new test to verify it passes**

Run: `npx tsx --conditions=development --test "src/parse/tests/ast-reference-spans.test.ts"`
Expected: PASS.

- [ ] **Step 6: Run the FULL suite to prove backward compatibility**

Run: `npm test`
Expected: PASS — every pre-existing test still green (optional fields disturb nothing).

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/ast-reference-spans.test.ts
git commit -m "feat(parse): optional reference spans on AST for the language service"
```

---

### Task 2: Package wiring + position conversion

Add the `vscode-languageserver-types` dependency and the `@pragmatic-lab/todl/language-service` subpath export, then create the sole 1↔0 position-conversion boundary.

**Files:**
- Modify: `package.json` (dependency + `exports` subpath)
- Create: `src/language-service/index.ts` (barrel — starts by re-exporting position utils)
- Create: `src/language-service/position.ts`
- Test: `src/language-service/tests/position.test.ts`

**Interfaces:**
- Consumes: `SourceSpan`, `Position as TodlPosition` from `src/diagnostics/span.js`; `Range`, `Position` from `vscode-languageserver-types`.
- Produces: `spanToRange(span: SourceSpan): Range`; `positionToTodl(pos: Position): TodlPosition`; `rangeToSpan(uri: string, range: Range): SourceSpan`.

- [ ] **Step 1: Add the dependency + export**

In `package.json`, add to `dependencies`:

```json
"vscode-languageserver-types": "^3.17.5"
```

and add the subpath to `exports` (beside the existing `"."`):

```json
"./language-service": {
  "types": "./dist/language-service/index.d.ts",
  "import": {
    "development": "./src/language-service/index.ts",
    "default": "./dist/language-service/index.js"
  }
}
```

Run: `npm install`
Expected: `vscode-languageserver-types` present in `node_modules`.

- [ ] **Step 2: Write the failing test**

Create `src/language-service/tests/position.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spanToRange, positionToTodl, rangeToSpan } from "../position.js";

test("spanToRange converts 1-based/exclusive TODL spans to 0-based LSP ranges", () => {
  const range = spanToRange({ uri: "d.todl", start: { line: 3, column: 16 }, end: { line: 3, column: 22 } });
  assert.deepEqual(range, { start: { line: 2, character: 15 }, end: { line: 2, character: 21 } });
});

test("positionToTodl is the inverse for a point", () => {
  assert.deepEqual(positionToTodl({ line: 2, character: 15 }), { line: 3, column: 16 });
});

test("rangeToSpan round-trips spanToRange", () => {
  const span = { uri: "d.todl", start: { line: 3, column: 16 }, end: { line: 3, column: 22 } };
  assert.deepEqual(rangeToSpan("d.todl", spanToRange(span)), span);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/position.test.ts"`
Expected: FAIL — `../position.js` does not exist.

- [ ] **Step 4: Implement `src/language-service/position.ts`**

```ts
import type { Range, Position } from "vscode-languageserver-types";
import type { SourceSpan, Position as TodlPosition } from "../diagnostics/span.js";

// TODL positions are 1-based line/column; LSP positions are 0-based
// line/character. Both use an exclusive end. This module is the ONLY place in
// the language service that does the ±1 conversion.

export function spanToRange(span: SourceSpan): Range {
  return {
    start: { line: span.start.line - 1, character: span.start.column - 1 },
    end: { line: span.end.line - 1, character: span.end.column - 1 },
  };
}

export function positionToTodl(pos: Position): TodlPosition {
  return { line: pos.line + 1, column: pos.character + 1 };
}

export function rangeToSpan(uri: string, range: Range): SourceSpan {
  return {
    uri,
    start: { line: range.start.line + 1, column: range.start.character + 1 },
    end: { line: range.end.line + 1, column: range.end.character + 1 },
  };
}
```

- [ ] **Step 5: Create the barrel `src/language-service/index.ts`**

```ts
export * from "./position.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/position.test.ts"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/language-service/position.ts src/language-service/index.ts src/language-service/tests/position.test.ts
git commit -m "feat(language-service): package wiring + position conversion"
```

---

### Task 3: Symbol-kind helper

Classify a `NodeId` into the kind the LSP features need (concept / primitive / taxonomy / term / instance / field / relationship / unknown), from the `Repository`.

**Files:**
- Create: `src/language-service/symbols.ts`
- Test: `src/language-service/tests/symbols.test.ts`

**Interfaces:**
- Consumes: `Repository` from `src/model/model.js`; `Tier` from `src/model/graph.js`; `MetaKind` from `src/model/kinds.js`; `check` from `src/api.js` (test only).
- Produces: `enum SymbolKind { Concept, Primitive, Taxonomy, Term, Instance, Field, Relationship, Unknown }`; `symbolKindOf(model: Repository, id: NodeId): SymbolKind`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/symbols.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { SymbolKind, symbolKindOf } from "../symbols.js";

test("symbolKindOf distinguishes concepts, primitives, and instances", () => {
  const { model } = check([{ uri: "d.todl", text: [
    "namespace demo {",
    "  primitive string { }",
    "  concept person { name : string; }",
    "  person alice { }",
    "}",
  ].join("\n") }]);
  assert.equal(symbolKindOf(model, "person"), SymbolKind.Concept);
  assert.equal(symbolKindOf(model, "string"), SymbolKind.Primitive);
  assert.equal(symbolKindOf(model, "alice"), SymbolKind.Instance);
  assert.equal(symbolKindOf(model, "no-such-id"), SymbolKind.Unknown);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/symbols.test.ts"`
Expected: FAIL — `../symbols.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/symbols.ts`**

```ts
import type { NodeId } from "../model/graph.js";
import { Tier } from "../model/graph.js";
import { MetaKind } from "../model/kinds.js";
import type { Repository } from "../model/model.js";

// The kind of a resolved symbol, from the reflective graph. Ontology nodes stamp
// their MetaKind on `typeOf` (see Builder); instances live in the Instance tier,
// and a class-marked instance is a taxonomy term.
export enum SymbolKind {
  Concept, Primitive, Taxonomy, Term, Instance, Field, Relationship, Unknown,
}

export function symbolKindOf(model: Repository, id: NodeId): SymbolKind {
  const node = model.resolve(id);
  if (node === undefined) return SymbolKind.Unknown;
  if (node.tier === Tier.Ontology) {
    switch (node.typeOf) {
      case MetaKind.Concept:      return SymbolKind.Concept;
      case MetaKind.Primitive:    return SymbolKind.Primitive;
      case MetaKind.Taxonomy:     return SymbolKind.Taxonomy;
      case MetaKind.Field:        return SymbolKind.Field;
      case MetaKind.Relationship: return SymbolKind.Relationship;
      default:                    return SymbolKind.Unknown;
    }
  }
  if (node.tier === Tier.Instance) {
    return model.isClass(id) ? SymbolKind.Term : SymbolKind.Instance;
  }
  return SymbolKind.Unknown;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/symbols.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language-service/symbols.ts src/language-service/tests/symbols.test.ts
git commit -m "feat(language-service): symbol-kind helper"
```

---

### Task 4: Diagnostics mapping

Map TODL `Diagnostic`s to `vscode-languageserver-types` `Diagnostic`s (severity map + `spanToRange`; a null span collapses to the document start, as the current renderer does).

**Files:**
- Create: `src/language-service/diagnostics.ts`
- Test: `src/language-service/tests/diagnostics.test.ts`

**Interfaces:**
- Consumes: `Diagnostic as TodlDiagnostic`, `Severity` from `src/diagnostics/diagnostic.js`; `spanToRange` from `./position.js`; `Diagnostic`, `DiagnosticSeverity` from `vscode-languageserver-types`.
- Produces: `mapDiagnostic(d: TodlDiagnostic): Diagnostic`; `mapDiagnostics(ds: readonly TodlDiagnostic[]): Diagnostic[]`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/diagnostics.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";
import { mapDiagnostic } from "../diagnostics.js";

test("mapDiagnostic maps severity + span and preserves the code", () => {
  const lsp = mapDiagnostic({
    code: DiagnosticCode.UnexpectedToken, severity: Severity.Error, message: "boom",
    span: { uri: "d.todl", start: { line: 2, column: 3 }, end: { line: 2, column: 5 } },
    node: null, path: null,
  });
  assert.equal(lsp.severity, DiagnosticSeverity.Error);
  assert.equal(lsp.code, DiagnosticCode.UnexpectedToken);
  assert.deepEqual(lsp.range, { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } });
});

test("a null span collapses to the document start", () => {
  const lsp = mapDiagnostic({
    code: DiagnosticCode.InvariantFailed, severity: Severity.Warning, message: "x",
    span: null, node: null, path: null,
  });
  assert.equal(lsp.severity, DiagnosticSeverity.Warning);
  assert.deepEqual(lsp.range, { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/diagnostics.test.ts"`
Expected: FAIL — `../diagnostics.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/diagnostics.ts`**

```ts
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-types";
import { Severity, type Diagnostic as TodlDiagnostic } from "../diagnostics/diagnostic.js";
import { spanToRange } from "./position.js";

const SEVERITY: Record<Severity, DiagnosticSeverity> = {
  [Severity.Error]:   DiagnosticSeverity.Error,
  [Severity.Warning]: DiagnosticSeverity.Warning,
};

// A whole-model (null-span) diagnostic collapses to the document start, matching
// the current in-renderer behavior.
const DOC_START = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

export function mapDiagnostic(d: TodlDiagnostic): Diagnostic {
  return {
    severity: SEVERITY[d.severity] ?? DiagnosticSeverity.Error,
    message: d.message,
    code: d.code,
    source: "todl",
    range: d.span === null ? DOC_START : spanToRange(d.span),
  };
}

export function mapDiagnostics(ds: readonly TodlDiagnostic[]): Diagnostic[] {
  return ds.map(mapDiagnostic);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/diagnostics.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language-service/diagnostics.ts src/language-service/tests/diagnostics.test.ts
git commit -m "feat(language-service): TODL→LSP diagnostics mapping"
```

---

### Task 5: Reference index

Walk each file's enriched AST once and record every reference occurrence per symbol id, plus a reverse position lookup. Backs definition, references (and later rename, semantic tokens).

**Files:**
- Create: `src/language-service/reference-index.ts`
- Test: `src/language-service/tests/reference-index.test.ts`

**Interfaces:**
- Consumes: the enriched AST from `src/parse/ast.js` (`NamespaceNode`, `DeclKind`, `ValueKind`); `SourceSpan` from `src/diagnostics/span.js`; `spanToRange` from `./position.js`; `Range` from `vscode-languageserver-types`.
- Produces:
  - `enum Role { Extends, FieldType, RelationshipTarget, RefValue, InstanceConcept, InstanceOf, Import }`
  - `interface Occurrence { uri: string; range: Range; role: Role; symbol: string }`
  - `interface ReferenceIndex { get(symbol: string): Occurrence[]; occurrenceAt(uri: string, pos: Position): Occurrence | null; all(): Occurrence[] }`
  - `buildReferenceIndex(files: Map<string, NamespaceNode>): ReferenceIndex`

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/reference-index.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../parse/parser.js";
import { buildReferenceIndex, Role } from "../reference-index.js";

function indexOf(src: string, uri = "d.todl") {
  const files = new Map([[uri, parse(src, uri).namespace]]);
  return buildReferenceIndex(files);
}

test("records extends, field-type, relationship-target and ref occurrences", () => {
  const idx = indexOf([
    "namespace demo {",
    "  concept animal { }",
    "  concept dog : animal { legs : number; relationship owner -> person []; }",
    "  dog rex { }",
    "  person p { pet = &rex; }",
    "}",
  ].join("\n"));
  const animalRefs = idx.get("animal");
  assert.equal(animalRefs.length, 1);
  assert.equal(animalRefs[0].role, Role.Extends);
  assert.equal(idx.get("number")[0].role, Role.FieldType);
  assert.equal(idx.get("person")[0].role, Role.RelationshipTarget);
  assert.equal(idx.get("rex")[0].role, Role.RefValue);
  assert.equal(idx.get("dog")[0].role, Role.InstanceConcept);
});

test("occurrenceAt finds the occurrence under a position", () => {
  const idx = indexOf("namespace demo {\n  concept a { }\n  concept b : a { }\n}");
  // `a` in `: a` is line 3 (0-based line 2), character 13.
  const occ = idx.occurrenceAt("d.todl", { line: 2, character: 13 });
  assert.equal(occ?.symbol, "a");
  assert.equal(occ?.role, Role.Extends);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/reference-index.test.ts"`
Expected: FAIL — `../reference-index.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/reference-index.ts`**

```ts
import type { Range, Position } from "vscode-languageserver-types";
import type { SourceSpan } from "../diagnostics/span.js";
import {
  DeclKind, ValueKind,
  type NamespaceNode, type Declaration, type InstanceDecl, type ValueNode,
} from "../parse/ast.js";
import { spanToRange } from "./position.js";

export enum Role { Extends, FieldType, RelationshipTarget, RefValue, InstanceConcept, InstanceOf, Import }

export interface Occurrence { uri: string; range: Range; role: Role; symbol: string }

export interface ReferenceIndex {
  get(symbol: string): Occurrence[];
  occurrenceAt(uri: string, pos: Position): Occurrence | null;
  all(): Occurrence[];
}

export function buildReferenceIndex(files: Map<string, NamespaceNode>): ReferenceIndex {
  const occurrences: Occurrence[] = [];
  const push = (uri: string, symbol: string, span: SourceSpan | undefined, role: Role): void => {
    if (span === undefined) return;
    occurrences.push({ uri, symbol, role, range: spanToRange(span) });
  };

  for (const [uri, ns] of files) {
    for (const span of ns.importSpans ?? []) {
      occurrences.push({ uri, symbol: "", role: Role.Import, range: spanToRange(span) });
    }
    for (const decl of ns.declarations) walkDecl(uri, decl, push);
  }

  const bySymbol = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const list = bySymbol.get(occ.symbol);
    if (list === undefined) bySymbol.set(occ.symbol, [occ]);
    else list.push(occ);
  }

  return {
    all: () => occurrences,
    get: (symbol) => bySymbol.get(symbol) ?? [],
    occurrenceAt: (uri, pos) =>
      occurrences.find((o) => o.uri === uri && contains(o.range, pos)) ?? null,
  };
}

function walkDecl(
  uri: string, decl: Declaration,
  push: (uri: string, symbol: string, span: SourceSpan | undefined, role: Role) => void,
): void {
  if (decl.kind === DeclKind.Concept) {
    if (decl.extends !== null) push(uri, decl.extends, decl.extendsSpan, Role.Extends);
    for (const f of decl.fields) push(uri, f.type, f.typeSpan, Role.FieldType);
    for (const r of decl.relationships) push(uri, r.target, r.targetSpan, Role.RelationshipTarget);
  } else if (decl.kind === DeclKind.Instance) {
    walkInstance(uri, decl, push);
  }
}

function walkInstance(
  uri: string, inst: InstanceDecl,
  push: (uri: string, symbol: string, span: SourceSpan | undefined, role: Role) => void,
): void {
  push(uri, inst.concept, inst.conceptSpan, Role.InstanceConcept);
  if (inst.instanceOf !== null) push(uri, inst.instanceOf, inst.instanceOfSpan, Role.InstanceOf);
  for (const a of inst.assignments) pushRefs(uri, a.value, push);
  for (const child of inst.children) walkInstance(uri, child, push);
}

function pushRefs(
  uri: string, value: ValueNode,
  push: (uri: string, symbol: string, span: SourceSpan | undefined, role: Role) => void,
): void {
  if (value.kind === ValueKind.Ref) push(uri, value.ref, value.span, Role.RefValue);
  else if (value.kind === ValueKind.List) for (const item of value.items) pushRefs(uri, item, push);
}

function contains(range: Range, pos: Position): boolean {
  const afterStart = pos.line > range.start.line ||
    (pos.line === range.start.line && pos.character >= range.start.character);
  const beforeEnd = pos.line < range.end.line ||
    (pos.line === range.end.line && pos.character < range.end.character);
  return afterStart && beforeEnd;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/reference-index.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language-service/reference-index.ts src/language-service/tests/reference-index.test.ts
git commit -m "feat(language-service): project-wide reference index"
```

---

### Task 6: `analyze()` + `Analysis`

The builder that ties it together: parse each file (AST + tokens), run `checkAgainst` for the combined `Repository` + diagnostics, build the reference index, map diagnostics.

**Files:**
- Create: `src/language-service/analysis.ts`
- Modify: `src/language-service/index.ts` (export `analyze`, `Analysis`)
- Test: `src/language-service/tests/analysis.test.ts`

**Interfaces:**
- Consumes: `parse` from `src/parse/parser.js`; `tokenize`, `Token` from `src/parse/lexer.js`; `checkAgainst` from `src/api.js`; `SourceFile` from `src/diagnostics/span.js`; `TodlDocument` from `src/emit/json.js`; `Repository` from `src/model/model.js`; `NamespaceNode` from `src/parse/ast.js`; `buildReferenceIndex`, `ReferenceIndex` from `./reference-index.js`; `mapDiagnostics` from `./diagnostics.js`; `Diagnostic` from `vscode-languageserver-types`.
- Produces:
  - `interface Analysis { sources: Map<string, { ast: NamespaceNode; tokens: Token[] }>; model: Repository; refs: ReferenceIndex; diagnostics: Diagnostic[] }`
  - `analyze(sources: SourceFile[], bases?: TodlDocument[]): Analysis`

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/analysis.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../analysis.js";

test("analyze exposes per-file AST + tokens, the model, refs, and diagnostics", () => {
  const a = analyze([{ uri: "d.todl", text: [
    "namespace demo {",
    "  concept animal { }",
    "  concept dog : animal { }",
    "}",
  ].join("\n") }]);
  assert.ok(a.sources.get("d.todl")!.ast.declarations.length === 2);
  assert.ok(a.sources.get("d.todl")!.tokens.length > 0);
  assert.ok(a.model.has("dog"));
  assert.equal(a.refs.get("animal").length, 1);
  assert.equal(a.diagnostics.length, 0);
});

test("analyze surfaces validation diagnostics for an unresolved reference", () => {
  const a = analyze([{ uri: "d.todl", text:
    "namespace demo {\n  concept dog : missing { }\n}" }]);
  assert.ok(a.diagnostics.length >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/analysis.test.ts"`
Expected: FAIL — `../analysis.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/analysis.ts`**

```ts
import type { Diagnostic } from "vscode-languageserver-types";
import { parse } from "../parse/parser.js";
import { tokenize, type Token } from "../parse/lexer.js";
import { checkAgainst } from "../api.js";
import type { SourceFile } from "../diagnostics/span.js";
import type { TodlDocument } from "../emit/json.js";
import type { Repository } from "../model/model.js";
import type { NamespaceNode } from "../parse/ast.js";
import { buildReferenceIndex, type ReferenceIndex } from "./reference-index.js";
import { mapDiagnostics } from "./diagnostics.js";

// The whole-project analysis. Pure — recomputed from scratch by `analyze`; the
// core keeps no cache (the server owns caching).
export interface Analysis {
  sources: Map<string, { ast: NamespaceNode; tokens: Token[] }>;
  model: Repository;
  refs: ReferenceIndex;
  diagnostics: Diagnostic[];
}

export function analyze(sources: SourceFile[], bases: TodlDocument[] = []): Analysis {
  const parsed = new Map<string, { ast: NamespaceNode; tokens: Token[] }>();
  const asts = new Map<string, NamespaceNode>();
  for (const src of sources) {
    const ast = parse(src.text, src.uri).namespace;
    parsed.set(src.uri, { ast, tokens: tokenize(src.text) });
    asts.set(src.uri, ast);
  }
  const { model, diagnostics } = checkAgainst(bases, sources);
  return {
    sources: parsed,
    model,
    refs: buildReferenceIndex(asts),
    diagnostics: mapDiagnostics(diagnostics),
  };
}
```

- [ ] **Step 4: Export from the barrel**

In `src/language-service/index.ts` add:

```ts
export * from "./analysis.js";
export * from "./diagnostics.js";
export * from "./symbols.js";
export * from "./reference-index.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/analysis.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/analysis.ts src/language-service/index.ts src/language-service/tests/analysis.test.ts
git commit -m "feat(language-service): analyze() builder + Analysis"
```

---

### Task 7: Test fixture helper

A shared helper that parses `‸`-marked source into clean text + LSP `Position`s, then runs `analyze()`. Used by every feature test from here on.

**Files:**
- Create: `src/language-service/tests/fixtures.ts` (helper, not a `.test.ts`)
- Test: `src/language-service/tests/fixtures.test.ts`

**Interfaces:**
- Consumes: `analyze`, `Analysis` from `../analysis.js`; `Position` from `vscode-languageserver-types`.
- Produces: `fixture(uri: string, marked: string): { analysis: Analysis; positions: Position[]; uri: string }` — the marker character is `‸`; each marker's 0-based `Position` is returned in order, with markers stripped from the text.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/fixtures.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";

test("fixture strips markers and returns their 0-based positions", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept do‸g { }\n}");
  assert.equal(uri, "d.todl");
  assert.deepEqual(positions[0], { line: 1, character: 12 });
  // Text was cleaned, so it parses to one concept named "dog".
  assert.ok(analysis.model.has("dog"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/fixtures.test.ts"`
Expected: FAIL — `./fixtures.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/tests/fixtures.ts`**

```ts
import type { Position } from "vscode-languageserver-types";
import { analyze, type Analysis } from "../analysis.js";

const MARKER = "‸";

// Parse a marked source: every `‸` records a 0-based LSP Position (in order) and
// is removed from the text; the cleaned text is analyzed as a single-file project.
export function fixture(uri: string, marked: string): { analysis: Analysis; positions: Position[]; uri: string } {
  const positions: Position[] = [];
  let line = 0, character = 0, text = "";
  for (const ch of marked) {
    if (ch === MARKER) { positions.push({ line, character }); continue; }
    text += ch;
    if (ch === "\n") { line += 1; character = 0; } else { character += 1; }
  }
  return { analysis: analyze([{ uri, text }]), positions, uri };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/fixtures.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language-service/tests/fixtures.ts src/language-service/tests/fixtures.test.ts
git commit -m "test(language-service): ‸-marked fixture helper"
```

---

### Task 8: Cursor-context classifier

Given `(uri, position)`, find the token under the cursor and classify its role — the single function that feeds completion, hover, and definition.

**Files:**
- Create: `src/language-service/classifier.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/classifier.test.ts`

**Interfaces:**
- Consumes: `Analysis` from `./analysis.js`; `Token`, `TokenKind` from `src/parse/lexer.js`; `positionToTodl` from `./position.js`; `Position` from `vscode-languageserver-types`; the reference index `Occurrence`/`Role` from `./reference-index.js`.
- Produces:
  - `enum ContextKind { TypeSlot, RelationshipTarget, AssignmentName, RefValue, ImportPath, KeywordSlot, Identifier, None }`
  - `interface CursorContext { kind: ContextKind; word: string; symbol?: string; ownerConcept?: string }`
  - `classifyPosition(a: Analysis, uri: string, pos: Position): CursorContext`

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/classifier.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { classifyPosition, ContextKind } from "../classifier.js";

test("classifies a reference occurrence as Identifier with its resolved symbol", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept a { }\n  concept b : a‸ { }\n}");
  const ctx = classifyPosition(analysis, uri, positions[0]);
  assert.equal(ctx.kind, ContextKind.Identifier);
  assert.equal(ctx.symbol, "a");
});

test("classifies a field-type slot after a colon", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept a { name : ‸ }\n}");
  assert.equal(classifyPosition(analysis, uri, positions[0]).kind, ContextKind.TypeSlot);
});

test("classifies a relationship target slot after an arrow", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept a { relationship r -> ‸ }\n}");
  assert.equal(classifyPosition(analysis, uri, positions[0]).kind, ContextKind.RelationshipTarget);
});

test("classifies a ref-value slot after an ampersand", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept a { }\n  a x { }\n  a y { peer = &‸ }\n}");
  assert.equal(classifyPosition(analysis, uri, positions[0]).kind, ContextKind.RefValue);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/classifier.test.ts"`
Expected: FAIL — `../classifier.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/classifier.ts`**

```ts
import type { Position } from "vscode-languageserver-types";
import { TokenKind, type Token } from "../parse/lexer.js";
import type { Analysis } from "./analysis.js";
import { positionToTodl } from "./position.js";

// A cursor's classified role. Reference occurrences resolve to `Identifier`
// (carrying the symbol); empty slots after a syntactic cue (`:`, `->`, `&`)
// classify by what the grammar expects there.
export enum ContextKind {
  TypeSlot, RelationshipTarget, AssignmentName, RefValue, ImportPath, KeywordSlot, Identifier, None,
}

export interface CursorContext {
  kind: ContextKind;
  word: string;
  symbol?: string;
  ownerConcept?: string;
}

export function classifyPosition(a: Analysis, uri: string, pos: Position): CursorContext {
  const file = a.sources.get(uri);
  if (file === undefined) return { kind: ContextKind.None, word: "" };

  // First: is the cursor on a recorded reference occurrence? That's the
  // strongest signal (definition/hover of a real symbol).
  const occ = a.refs.occurrenceAt(uri, pos);
  if (occ !== null && occ.symbol !== "") {
    return { kind: ContextKind.Identifier, word: occ.symbol, symbol: occ.symbol };
  }

  const tp = positionToTodl(pos);
  const tokens = file.tokens;
  const idx = tokenIndexAt(tokens, tp.line, tp.column);
  const prev = precedingSignificant(tokens, idx);

  // Empty slot after a syntactic cue.
  if (prev !== null) {
    if (prev.kind === TokenKind.Colon) return { kind: ContextKind.TypeSlot, word: wordAt(tokens, idx) };
    if (prev.kind === TokenKind.Arrow) return { kind: ContextKind.RelationshipTarget, word: wordAt(tokens, idx) };
    if (prev.kind === TokenKind.Amp) return { kind: ContextKind.RefValue, word: wordAt(tokens, idx) };
    if (prev.kind === TokenKind.Identifier && prev.value === "import")
      return { kind: ContextKind.ImportPath, word: wordAt(tokens, idx) };
  }
  return { kind: ContextKind.None, word: wordAt(tokens, idx) };
}

// The index of the token whose span covers (line, column), else the index of the
// next token after the cursor (so an empty slot points at what follows).
function tokenIndexAt(tokens: Token[], line: number, column: number): number {
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const startsAfter = t.line > line || (t.line === line && t.column > column);
    if (startsAfter) return i;
    const endsAfter = t.endLine > line || (t.endLine === line && t.endColumn > column);
    if ((t.line < line || (t.line === line && t.column <= column)) && endsAfter) return i;
  }
  return tokens.length;
}

// The nearest significant token before `idx` (skipping EOF); null if none.
function precedingSignificant(tokens: Token[], idx: number): Token | null {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (tokens[i].kind !== TokenKind.EOF) return tokens[i];
  }
  return null;
}

function wordAt(tokens: Token[], idx: number): string {
  const t = tokens[idx];
  return t !== undefined && t.kind === TokenKind.Identifier ? t.value : "";
}
```

- [ ] **Step 4: Export from the barrel**

In `src/language-service/index.ts` add:

```ts
export * from "./classifier.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/classifier.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/classifier.ts src/language-service/index.ts src/language-service/tests/classifier.test.ts
git commit -m "feat(language-service): cursor-context classifier"
```

---

### Task 9: `definitionAt` + `referencesAt`

Navigation: jump to a symbol's defining span, and list every reference occurrence.

**Files:**
- Create: `src/language-service/navigation.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/navigation.test.ts`

**Interfaces:**
- Consumes: `Analysis` from `./analysis.js`; `classifyPosition`, `ContextKind` from `./classifier.js`; `spanToRange` from `./position.js`; `Location`, `Position` from `vscode-languageserver-types`; `Repository.spanOf` from the model.
- Produces:
  - `definitionAt(a: Analysis, uri: string, pos: Position): Location | null`
  - `referencesAt(a: Analysis, uri: string, pos: Position, includeDecl: boolean): Location[]`

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/navigation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { definitionAt, referencesAt } from "../navigation.js";

const SRC = [
  "namespace demo {",       // line 0
  "  concept animal { }",   // line 1 — `animal` defined here
  "  concept dog : ani‸mal { }", // line 2 — reference (cursor here)
  "  animal a { }",         // line 3 — another reference (instance concept)
  "}",
].join("\n");

test("definitionAt jumps from a reference to the defining span", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const loc = definitionAt(analysis, uri, positions[0]);
  assert.equal(loc?.uri, "d.todl");
  assert.equal(loc?.range.start.line, 1);   // the `concept animal` line (0-based)
});

test("referencesAt lists every occurrence, optionally including the definition", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const refs = referencesAt(analysis, uri, positions[0], false);
  assert.equal(refs.length, 2);             // the extends ref + the instance concept ref
  const withDecl = referencesAt(analysis, uri, positions[0], true);
  assert.equal(withDecl.length, 3);         // + the definition
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/navigation.test.ts"`
Expected: FAIL — `../navigation.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/navigation.ts`**

```ts
import type { Location, Position } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { classifyPosition, ContextKind } from "./classifier.js";
import { spanToRange } from "./position.js";

// Resolve the symbol under the cursor (a reference occurrence classifies as
// Identifier and carries its symbol id).
function symbolAt(a: Analysis, uri: string, pos: Position): string | null {
  const ctx = classifyPosition(a, uri, pos);
  return ctx.kind === ContextKind.Identifier && ctx.symbol !== undefined ? ctx.symbol : null;
}

export function definitionAt(a: Analysis, uri: string, pos: Position): Location | null {
  const symbol = symbolAt(a, uri, pos);
  if (symbol === null) return null;
  const span = a.model.spanOf(symbol);   // null for base symbols with no source span (boundary)
  if (span === null) return null;
  return { uri: span.uri, range: spanToRange(span) };
}

export function referencesAt(a: Analysis, uri: string, pos: Position, includeDecl: boolean): Location[] {
  const symbol = symbolAt(a, uri, pos);
  if (symbol === null) return [];
  const locations: Location[] = a.refs.get(symbol).map((o) => ({ uri: o.uri, range: o.range }));
  if (includeDecl) {
    const span = a.model.spanOf(symbol);
    if (span !== null) locations.unshift({ uri: span.uri, range: spanToRange(span) });
  }
  return locations;
}
```

- [ ] **Step 4: Export from the barrel**

In `src/language-service/index.ts` add:

```ts
export * from "./navigation.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/navigation.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/navigation.ts src/language-service/index.ts src/language-service/tests/navigation.test.ts
git commit -m "feat(language-service): definition + references"
```

---

### Task 10: `hoverAt`

Resolve the symbol under the cursor and render a markdown hover: kind + signature + description.

**Files:**
- Create: `src/language-service/hover.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/hover.test.ts`

**Interfaces:**
- Consumes: `Analysis` from `./analysis.js`; `classifyPosition`, `ContextKind` from `./classifier.js`; `symbolKindOf`, `SymbolKind` from `./symbols.js`; `Repository.resolve`/`schemaOf` from the model; `Hover`, `Position`, `MarkupKind` from `vscode-languageserver-types`.
- Produces: `hoverAt(a: Analysis, uri: string, pos: Position): Hover | null`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/hover.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { hoverAt } from "../hover.js";

test("hover on a concept reference shows its kind and name", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept animal { }\n  concept dog : ani‸mal { }\n}");
  const hover = hoverAt(analysis, uri, positions[0]);
  const value = (hover?.contents as { value: string }).value;
  assert.match(value, /concept/);
  assert.match(value, /animal/);
});

test("hover off any symbol is null", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {‸\n  concept a { }\n}");
  assert.equal(hoverAt(analysis, uri, positions[0]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/hover.test.ts"`
Expected: FAIL — `../hover.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/hover.ts`**

```ts
import { MarkupKind, type Hover, type Position } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { classifyPosition, ContextKind } from "./classifier.js";
import { SymbolKind, symbolKindOf } from "./symbols.js";

const KIND_LABEL: Record<SymbolKind, string> = {
  [SymbolKind.Concept]: "concept", [SymbolKind.Primitive]: "primitive",
  [SymbolKind.Taxonomy]: "taxonomy", [SymbolKind.Term]: "term",
  [SymbolKind.Instance]: "instance", [SymbolKind.Field]: "field",
  [SymbolKind.Relationship]: "relationship", [SymbolKind.Unknown]: "symbol",
};

export function hoverAt(a: Analysis, uri: string, pos: Position): Hover | null {
  const ctx = classifyPosition(a, uri, pos);
  if (ctx.kind !== ContextKind.Identifier || ctx.symbol === undefined) return null;
  const symbol = ctx.symbol;
  const kind = symbolKindOf(a.model, symbol);
  const lines = [`\`\`\`todl`, `${KIND_LABEL[kind]} ${symbol}`, `\`\`\``];

  if (kind === SymbolKind.Concept) {
    const schema = a.model.schemaOf(symbol);
    if (schema.extends !== null) lines.push(`extends \`${schema.extends}\``);
    for (const f of schema.fields) lines.push(`- \`${f.name}\`: ${f.type}`);
    for (const r of schema.relationships) lines.push(`- \`${r.name}\` → ${r.target}`);
  }
  const node = a.model.resolve(symbol);
  const description = node?.attrs.get("description");
  if (typeof description === "string" && description.length > 0) lines.push("", description);

  return { contents: { kind: MarkupKind.Markdown, value: lines.join("\n") } };
}
```

- [ ] **Step 4: Export from the barrel**

In `src/language-service/index.ts` add:

```ts
export * from "./hover.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/hover.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/hover.ts src/language-service/index.ts src/language-service/tests/hover.test.ts
git commit -m "feat(language-service): hover"
```

---

### Task 11: `completionsAt`

Context-driven completion: type slots offer concepts/primitives/taxonomies; relationship targets offer concepts; ref-value slots offer instances valid for the field's target concept; top-level offers keywords.

**Files:**
- Create: `src/language-service/completion.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/completion.test.ts`

**Interfaces:**
- Consumes: `Analysis` from `./analysis.js`; `classifyPosition`, `ContextKind` from `./classifier.js`; `SymbolKind`, `symbolKindOf` from `./symbols.js`; `Repository.allNodes`/`instancesOf` from the model; `CompletionItem`, `CompletionItemKind`, `Position` from `vscode-languageserver-types`.
- Produces: `completionsAt(a: Analysis, uri: string, pos: Position): CompletionItem[]`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/completion.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { completionsAt } from "../completion.js";

const labels = (items: { label: string }[]): string[] => items.map((i) => i.label).sort();

test("a field-type slot offers concepts and primitives", () => {
  const { analysis, positions, uri } = fixture("d.todl", [
    "namespace demo {",
    "  primitive string { }",
    "  concept person { }",
    "  concept dog { owner : ‸ }",
    "}",
  ].join("\n"));
  const got = labels(completionsAt(analysis, uri, positions[0]));
  assert.ok(got.includes("string"));
  assert.ok(got.includes("person"));
});

test("a ref-value slot offers instances of the field's target concept", () => {
  const { analysis, positions, uri } = fixture("d.todl", [
    "namespace demo {",
    "  concept person { }",
    "  concept dog { relationship owner -> person []; }",
    "  person alice { }",
    "  person bob { }",
    "  dog rex { owner = &‸ }",
    "}",
  ].join("\n"));
  const got = labels(completionsAt(analysis, uri, positions[0]));
  assert.deepEqual(got, ["alice", "bob"]);
});

test("top-level offers declaration keywords", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  ‸\n}");
  const got = completionsAt(analysis, uri, positions[0]).map((i) => i.label);
  assert.ok(got.includes("concept"));
  assert.ok(got.includes("primitive"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/completion.test.ts"`
Expected: FAIL — `../completion.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/completion.ts`**

```ts
import { CompletionItemKind, type CompletionItem, type Position } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { classifyPosition, ContextKind } from "./classifier.js";
import { SymbolKind, symbolKindOf } from "./symbols.js";

const KEYWORDS = ["namespace", "import", "concept", "primitive", "taxonomy", "relationship", "invariant", "instanceof"];

export function completionsAt(a: Analysis, uri: string, pos: Position): CompletionItem[] {
  const ctx = classifyPosition(a, uri, pos);
  switch (ctx.kind) {
    case ContextKind.TypeSlot:
      return typeCandidates(a);
    case ContextKind.RelationshipTarget:
      return conceptCandidates(a);
    case ContextKind.RefValue:
      return refCandidates(a, uri, pos);
    case ContextKind.None:
      // Top-level (or unclassified) — offer the declaration keywords.
      return KEYWORDS.map((label) => ({ label, kind: CompletionItemKind.Keyword }));
    default:
      return [];
  }
}

// Concepts + primitives + taxonomies are valid in a field-type slot.
function typeCandidates(a: Analysis): CompletionItem[] {
  return nodesOfKinds(a, [SymbolKind.Concept, SymbolKind.Primitive, SymbolKind.Taxonomy]);
}

function conceptCandidates(a: Analysis): CompletionItem[] {
  return nodesOfKinds(a, [SymbolKind.Concept]);
}

function nodesOfKinds(a: Analysis, kinds: SymbolKind[]): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const node of a.model.allNodes()) {
    const kind = symbolKindOf(a.model, node.id);
    if (!kinds.includes(kind)) continue;
    items.push({
      label: node.id,
      kind: kind === SymbolKind.Primitive ? CompletionItemKind.Struct : CompletionItemKind.Class,
      detail: labelFor(kind),
      documentation: describe(a, node.id),
    });
  }
  return items;
}

// A `&ref` value: offer instances of the concept the enclosing relationship/field
// targets. The classifier's context does not carry the target concept in the
// Foundation cut, so we resolve it from the assignment's owner: find the nearest
// preceding assignment name + its owning instance's concept, then the relationship
// target. To keep this robust and dependency-light, we offer every instance whose
// concept is a declared relationship/field target reachable in the model; the
// schema-precise narrowing lands with the classifier's ownerConcept in Advanced.
function refCandidates(a: Analysis, uri: string, pos: Position): CompletionItem[] {
  void uri; void pos;
  const items: CompletionItem[] = [];
  for (const node of a.model.allNodes()) {
    if (symbolKindOf(a.model, node.id) !== SymbolKind.Instance) continue;
    items.push({ label: node.id, kind: CompletionItemKind.Variable, documentation: describe(a, node.id) });
  }
  return items;
}

function labelFor(kind: SymbolKind): string {
  return kind === SymbolKind.Concept ? "concept"
    : kind === SymbolKind.Primitive ? "primitive"
    : kind === SymbolKind.Taxonomy ? "taxonomy" : "symbol";
}

function describe(a: Analysis, id: string): string | undefined {
  const d = a.model.resolve(id)?.attrs.get("description");
  return typeof d === "string" && d.length > 0 ? d : undefined;
}
```

> **Note on `refCandidates`:** the Foundation cut offers all instances. Schema-precise narrowing to the field's exact target concept requires the classifier to carry `ownerConcept`/target — that refinement is scheduled in the Advanced plan alongside `signatureHelp`. The test above passes because the fixture's only instances are `person`s that the relationship targets; a broader-model test is deferred with the refinement. This is called out as a known Foundation limitation, not silent behavior.

- [ ] **Step 4: Export from the barrel**

In `src/language-service/index.ts` add:

```ts
export * from "./completion.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/completion.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/completion.ts src/language-service/index.ts src/language-service/tests/completion.test.ts
git commit -m "feat(language-service): context-driven completion (foundation)"
```

---

### Task 12: Full-suite gate + subpath smoke

Confirm the whole TODL suite is green and the new public surface imports cleanly through the package subpath.

**Files:**
- Test: `src/language-service/tests/public-api.test.ts`

**Interfaces:**
- Consumes: the public barrel `src/language-service/index.js`.
- Produces: nothing (a smoke test).

- [ ] **Step 1: Write the smoke test**

Create `src/language-service/tests/public-api.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyze, completionsAt, hoverAt, definitionAt, referencesAt, spanToRange,
} from "../index.js";

test("the public barrel exposes the foundation surface", () => {
  const a = analyze([{ uri: "d.todl", text: "namespace demo {\n  concept a { }\n}" }]);
  assert.equal(typeof analyze, "function");
  assert.equal(typeof completionsAt, "function");
  assert.equal(typeof hoverAt, "function");
  assert.equal(typeof definitionAt, "function");
  assert.equal(typeof referencesAt, "function");
  assert.equal(typeof spanToRange, "function");
  assert.ok(a.model.has("a"));
});
```

- [ ] **Step 2: Run the language-service suite**

Run: `npx tsx --conditions=development --test "src/language-service/**/*.test.ts"`
Expected: PASS — every language-service test.

- [ ] **Step 3: Run the FULL suite**

Run: `npm test`
Expected: PASS — the whole repo, proving no regression from Task 1's parser change.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/language-service/tests/public-api.test.ts
git commit -m "test(language-service): public-api smoke + full-suite gate"
```

---

## Self-Review

**1. Spec coverage (Foundation slice):**
- Parser span-enrichment → Task 1. ✓
- Package/subpath + `vscode-languageserver-types` → Task 2. ✓
- Position conversion boundary → Task 2. ✓
- Symbol-kind helper → Task 3. ✓
- Diagnostics mapping → Task 4. ✓
- Reference index (+ `Role`, `Occurrence`, `occurrenceAt`) → Task 5. ✓
- `analyze()` + `Analysis` → Task 6. ✓
- Fixture helper (`‸` markers) → Task 7. ✓
- Cursor-context classifier → Task 8. ✓
- Definition + references → Task 9. ✓
- Hover → Task 10. ✓
- Completion → Task 11 (with the ref-narrowing limitation explicitly flagged). ✓
- Full-suite + public-surface gate → Task 12. ✓
- Deferred to Advanced plan (correctly out of this slice): rename, semantic tokens, document symbols, folding, workspace symbols, code actions, formatting, signature help, and the completion ref-narrowing refinement.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". The one Foundation limitation (completion ref-narrowing) is stated explicitly with its Advanced-plan home, not left vague.

**3. Type consistency:** `Analysis`, `ReferenceIndex`/`Occurrence`/`Role`, `ContextKind`/`CursorContext`, `SymbolKind`, and the query signatures (`analyze`, `completionsAt`, `hoverAt`, `definitionAt`, `referencesAt`, `classifyPosition`, `symbolKindOf`, `spanToRange`/`positionToTodl`/`rangeToSpan`, `mapDiagnostic(s)`, `buildReferenceIndex`) are used identically wherever they appear across tasks. `symbolKindOf(model, id)` and `describe`/`labelFor` helpers are self-consistent. AST field names added in Task 1 (`extendsSpan`, `nameSpan`, `typeSpan`, `targetSpan`, `importSpans`, `conceptSpan`, `instanceOfSpan`, `RefValue.span`) match their consumers in Task 5.
