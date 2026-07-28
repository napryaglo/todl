# TODL Language Service — Core Advanced Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the TODL analysis core with the advanced capabilities — rename, document symbols, folding, workspace symbols, semantic tokens, schema-aware `&ref` completion, signature help, code actions, and formatting — all pure and headless-tested.

**Architecture:** Builds on the Foundation core (`@pragmatic-lab/todl/language-service`). Adds a definition index (precise name-token spans) alongside the reference index, a schema-context resolver for assignment slots, and one focused module per capability. All query functions stay pure over `Analysis` and return `vscode-languageserver-types`.

**Tech Stack:** TypeScript (ESM, strict: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), the TODL compiler (`parse`, `tokenize`, `Repository`), `vscode-languageserver-types`, `node:test` via `tsx`.

**Spec:** [`2026-07-28-todl-language-service-core-design.md`](../specs/2026-07-28-todl-language-service-core-design.md). Foundation plan (done): [`2026-07-28-todl-language-service-core-foundation.md`](./2026-07-28-todl-language-service-core-foundation.md).

## Global Constraints

- **Result types:** every query returns `vscode-languageserver-types` values.
- **Positions:** TODL spans are 1-based/exclusive; LSP is 0-based. Conversion happens only via `position.ts` (`spanToRange`/`positionToTodl`/`rangeToSpan`).
- **Purity:** `analyze()` stays whole-project and cache-free.
- **Strict mode:** guard indexed access (`arr[i]` is `T | undefined`); never assign `undefined` to an optional property — omit it or guard.
- **Tests:** `tests/` subfolder next to source. Run `npx tsx --conditions=development --test "<glob>"`. Fixtures use the `‸` marker helper from `src/language-service/tests/fixtures.ts`.
- **Backward compatibility:** Task 1's AST additions are optional fields; the full existing suite must stay green.

**Existing Foundation surface this plan consumes:**
- `analyze(sources, bases?) => Analysis`, `Analysis { sources: Map<uri,{ast,tokens}>, model: Repository, refs: ReferenceIndex, diagnostics }`.
- `ReferenceIndex { get(symbol): Occurrence[]; occurrenceAt(uri,pos): Occurrence | null; all() }`, `Occurrence { uri, range, role, symbol }`, `enum Role`.
- `classifyPosition(a, uri, pos): CursorContext`, `enum ContextKind`.
- `SymbolKind`, `symbolKindOf(model, id)`.
- `spanToRange`, `positionToTodl`, `rangeToSpan`.
- `Repository`: `spanOf(id)` (whole-decl span), `schemaOf(id)`/`effectiveSchema(id)` (`{concept, extends, fields:[{name,type,cardinality}], relationships:[{name,target,cardinality,inverse}]}`), `subtypesOf(id)`, `instancesOf(id)`, `allNodes()`, `resolve(id)`, `has(id)`.

---

### Task 1: Parser round-2 — definition name/id spans

`spanOf` records the whole declaration span, so rename / outline / semantic tokens need the precise name-token span. Add optional name/id spans to the definition AST nodes.

**Files:**
- Modify: `src/parse/ast.ts`
- Modify: `src/parse/parser.ts`
- Test: `src/parse/tests/ast-definition-spans.test.ts` (new)

**Interfaces:**
- Consumes: `tokenSpan`, `SourceSpan` from `src/diagnostics/span.js`.
- Produces (new optional AST fields): `ConceptDecl.nameSpan?`, `PrimitiveDecl.nameSpan?`, `TaxonomyDecl.nameSpan?`, `InstanceDecl.idSpan?`, `Term.idSpan?` (all `SourceSpan`).

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/ast-definition-spans.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type ConceptDecl, type PrimitiveDecl, type InstanceDecl } from "../ast.js";

test("concept, primitive names and instance ids carry name spans", () => {
  const src = [
    "namespace demo {",
    "  primitive string { }",
    "  concept person { }",
    "  person alice { }",
    "}",
  ].join("\n");
  const { namespace } = parse(src, "d.todl");
  const prim = namespace.declarations.find(
    (d): d is PrimitiveDecl => d.kind === DeclKind.Primitive)!;
  const concept = namespace.declarations.find(
    (d): d is ConceptDecl => d.kind === DeclKind.Concept)!;
  const inst = namespace.declarations.find(
    (d): d is InstanceDecl => d.kind === DeclKind.Instance)!;
  // `string` starts at line 2 (1-based), column 13.
  assert.deepEqual(prim.nameSpan?.start, { line: 2, column: 13 });
  // `person` starts at line 3, column 11.
  assert.deepEqual(concept.nameSpan?.start, { line: 3, column: 11 });
  // `alice` (the id) starts at line 4, column 10.
  assert.deepEqual(inst.idSpan?.start, { line: 4, column: 10 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/parse/tests/ast-definition-spans.test.ts"`
Expected: FAIL — `nameSpan`/`idSpan` are `undefined`.

- [ ] **Step 3: Add optional fields in `src/parse/ast.ts`**

Add `nameSpan?: SourceSpan;` to `ConceptDecl`, `PrimitiveDecl`, `TaxonomyDecl`; add `idSpan?: SourceSpan;` to `InstanceDecl` and `Term`.

- [ ] **Step 4: Capture the tokens in `src/parse/parser.ts`**

`parsePrimitive` — capture the name token:

```ts
this.expectKeyword("primitive");
const nameTok = this.expect(TokenKind.Identifier);
const name = nameTok.value;
```

and, on the return object, `const decl: PrimitiveDecl = { kind: DeclKind.Primitive, name, base, description, regex, span: this.spanFrom(start) }; decl.nameSpan = tokenSpan(nameTok, this.uri); return decl;`

`parseConcept` — the name is already `this.expectIdentifier()`; change to capture the token:

```ts
this.expectKeyword("concept");
const nameTok = this.expect(TokenKind.Identifier);
const name = nameTok.value;
```

and set `decl.nameSpan = tokenSpan(nameTok, this.uri);` on the `ConceptDecl` object built at the end (the object is already assembled into `const decl: ConceptDecl = …` from the Foundation change — add the assignment before `return decl;`).

`parseTaxonomy` — capture the name token the same way (`const nameTok = this.expect(TokenKind.Identifier); const name = nameTok.value;`) and add `taxonomy.nameSpan = tokenSpan(nameTok, this.uri);` to the returned `TaxonomyDecl` (assign via a `const decl: TaxonomyDecl = { … }; decl.nameSpan = …; return decl;`).

`parseInstanceFrom` — capture the id token. `expectRecordId` returns a string; add a token-returning variant so we get the span:

```ts
private expectRecordIdTok(): Token {
  if (this.check(TokenKind.String) || this.check(TokenKind.RawString)) return this.advance();
  return this.expect(TokenKind.Identifier);
}
```

Use it in `parseInstanceFrom`:

```ts
const idTok = this.expectRecordIdTok();
const id = idTok.value;
```

and set `decl.idSpan = tokenSpan(idTok, this.uri);` on the `InstanceDecl` (the `const decl: InstanceDecl = …` object from the Foundation change) before `return decl;`.

`parseTerm` — the id is `this.expectIdentifier()`; capture the token (`const idTok = this.expect(TokenKind.Identifier); const id = idTok.value;`) and build `const term: Term = { id, concept, assignments, children, span: this.spanFrom(start) }; term.idSpan = tokenSpan(idTok, this.uri); return term;`.

- [ ] **Step 5: Run the new test to verify it passes**

Run: `npx tsx --conditions=development --test "src/parse/tests/ast-definition-spans.test.ts"`
Expected: PASS.

- [ ] **Step 6: Full-suite backward-compat gate**

Run: `npm test`
Expected: PASS (all pre-existing tests green).

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/ast-definition-spans.test.ts
git commit -m "feat(parse): definition name/id spans for the language service"
```

---

### Task 2: Definition index + `text` on Analysis

A project-wide index of each symbol's precise defining name span + kind, and the raw source text on `Analysis.sources` (formatting needs it).

**Files:**
- Create: `src/language-service/definitions.ts`
- Modify: `src/language-service/analysis.ts` (build `defs`; add `text` to the per-file record)
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/definitions.test.ts`

**Interfaces:**
- Consumes: the enriched AST (`NamespaceNode`, `DeclKind`, name/id spans); `spanToRange` from `./position.js`; `SymbolKind` from `./symbols.js`; `Range`, `Position` from `vscode-languageserver-types`.
- Produces:
  - `interface Definition { symbol: string; uri: string; nameRange: Range; kind: SymbolKind }`
  - `interface DefinitionIndex { get(symbol: string): Definition | null; definitionAt(uri: string, pos: Position): Definition | null; all(): Definition[] }`
  - `buildDefinitionIndex(files: Map<string, NamespaceNode>): DefinitionIndex`
  - `Analysis.sources` value gains `text: string`; `Analysis` gains `defs: DefinitionIndex`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/definitions.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../parse/parser.js";
import { buildDefinitionIndex } from "../definitions.js";
import { SymbolKind } from "../symbols.js";

function defsOf(src: string, uri = "d.todl") {
  return buildDefinitionIndex(new Map([[uri, parse(src, uri).namespace]]));
}

test("indexes each definition's name range and kind", () => {
  const defs = defsOf([
    "namespace demo {",
    "  primitive string { }",
    "  concept person { }",
    "  person alice { }",
    "}",
  ].join("\n"));
  assert.equal(defs.get("person")?.kind, SymbolKind.Concept);
  assert.equal(defs.get("string")?.kind, SymbolKind.Primitive);
  assert.equal(defs.get("alice")?.kind, SymbolKind.Instance);
  // `person` name is on 0-based line 2, characters 10..16.
  assert.deepEqual(defs.get("person")?.nameRange, {
    start: { line: 2, character: 10 }, end: { line: 2, character: 16 },
  });
});

test("definitionAt resolves a position on a definition name", () => {
  const defs = defsOf("namespace demo {\n  concept person { }\n}");
  const hit = defs.definitionAt("d.todl", { line: 1, character: 12 });
  assert.equal(hit?.symbol, "person");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/definitions.test.ts"`
Expected: FAIL — `../definitions.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/definitions.ts`**

```ts
import type { Range, Position } from "vscode-languageserver-types";
import type { SourceSpan } from "../diagnostics/span.js";
import {
  DeclKind, type NamespaceNode, type Declaration, type InstanceDecl, type Term,
} from "../parse/ast.js";
import { spanToRange } from "./position.js";
import { SymbolKind } from "./symbols.js";

export interface Definition { symbol: string; uri: string; nameRange: Range; kind: SymbolKind }

export interface DefinitionIndex {
  get(symbol: string): Definition | null;
  definitionAt(uri: string, pos: Position): Definition | null;
  all(): Definition[];
}

export function buildDefinitionIndex(files: Map<string, NamespaceNode>): DefinitionIndex {
  const defs: Definition[] = [];
  const add = (uri: string, symbol: string, span: SourceSpan | undefined, kind: SymbolKind): void => {
    if (span === undefined) return;
    defs.push({ symbol, uri, kind, nameRange: spanToRange(span) });
  };

  for (const [uri, ns] of files) {
    for (const decl of ns.declarations) addDecl(uri, decl, add);
  }

  const bySymbol = new Map<string, Definition>();
  for (const d of defs) if (!bySymbol.has(d.symbol)) bySymbol.set(d.symbol, d);

  return {
    all: () => defs,
    get: (symbol) => bySymbol.get(symbol) ?? null,
    definitionAt: (uri, pos) => defs.find((d) => d.uri === uri && contains(d.nameRange, pos)) ?? null,
  };
}

function addDecl(
  uri: string, decl: Declaration,
  add: (uri: string, symbol: string, span: SourceSpan | undefined, kind: SymbolKind) => void,
): void {
  switch (decl.kind) {
    case DeclKind.Primitive: add(uri, decl.name, decl.nameSpan, SymbolKind.Primitive); break;
    case DeclKind.Concept:   add(uri, decl.name, decl.nameSpan, SymbolKind.Concept); break;
    case DeclKind.Taxonomy:
      add(uri, decl.name, decl.nameSpan, SymbolKind.Taxonomy);
      for (const term of decl.terms) addTerm(uri, decl.name, term, add);
      break;
    case DeclKind.Instance:  addInstance(uri, decl, add); break;
  }
}

function addInstance(
  uri: string, inst: InstanceDecl,
  add: (uri: string, symbol: string, span: SourceSpan | undefined, kind: SymbolKind) => void,
): void {
  add(uri, inst.id, inst.idSpan, inst.isClass ? SymbolKind.Term : SymbolKind.Instance);
  for (const child of inst.children) addInstance(uri, child, add);
}

function addTerm(
  uri: string, taxonomy: string, term: Term,
  add: (uri: string, symbol: string, span: SourceSpan | undefined, kind: SymbolKind) => void,
): void {
  // Taxonomy terms are keyed `<taxonomy>.<id>` in the loader's span table; the
  // index keys them by bare id for navigation, matching how they are referenced.
  add(uri, term.id, term.idSpan, SymbolKind.Term);
  for (const child of term.children) addTerm(uri, taxonomy, child, add);
}

function contains(range: Range, pos: Position): boolean {
  const afterStart = pos.line > range.start.line ||
    (pos.line === range.start.line && pos.character >= range.start.character);
  const beforeEnd = pos.line < range.end.line ||
    (pos.line === range.end.line && pos.character < range.end.character);
  return afterStart && beforeEnd;
}
```

- [ ] **Step 4: Wire `defs` + `text` into `analyze()` (`src/language-service/analysis.ts`)**

Change the `Analysis` interface and `analyze` body:

```ts
import { buildDefinitionIndex, type DefinitionIndex } from "./definitions.js";
// …existing imports…

export interface Analysis {
  sources: Map<string, { ast: NamespaceNode; tokens: Token[]; text: string }>;
  model: Repository;
  refs: ReferenceIndex;
  defs: DefinitionIndex;
  diagnostics: Diagnostic[];
}

export function analyze(sources: SourceFile[], bases: TodlDocument[] = []): Analysis {
  const parsed = new Map<string, { ast: NamespaceNode; tokens: Token[]; text: string }>();
  const asts = new Map<string, NamespaceNode>();
  for (const src of sources) {
    const ast = parse(src.text, src.uri).namespace;
    parsed.set(src.uri, { ast, tokens: tokenize(src.text), text: src.text });
    asts.set(src.uri, ast);
  }
  const { model, diagnostics } = checkAgainst(bases, sources);
  return {
    sources: parsed,
    model,
    refs: buildReferenceIndex(asts),
    defs: buildDefinitionIndex(asts),
    diagnostics: mapDiagnostics(diagnostics),
  };
}
```

- [ ] **Step 5: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./definitions.js";`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test "src/language-service/tests/definitions.test.ts"`
Expected: PASS. Then `npx tsx --conditions=development --test "src/language-service/tests/analysis.test.ts"` — still PASS (additive change).

- [ ] **Step 7: Commit**

```bash
git add src/language-service/definitions.ts src/language-service/analysis.ts src/language-service/index.ts src/language-service/tests/definitions.test.ts
git commit -m "feat(language-service): definition index + source text on Analysis"
```

---

### Task 3: Rename

`prepareRename` returns the identifier range at the cursor; `renameEdits` validates the new name and produces a project-wide `WorkspaceEdit` over the definition name + every reference.

**Files:**
- Create: `src/language-service/rename.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/rename.test.ts`

**Interfaces:**
- Consumes: `Analysis`; `Range`, `Position`, `WorkspaceEdit`, `TextEdit` from `vscode-languageserver-types`.
- Produces:
  - `interface RenameError { error: string }`
  - `prepareRename(a: Analysis, uri: string, pos: Position): Range | null`
  - `renameEdits(a: Analysis, uri: string, pos: Position, newName: string): WorkspaceEdit | RenameError`

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/rename.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { prepareRename, renameEdits } from "../rename.js";

const SRC = [
  "namespace demo {",
  "  concept ani‸mal { }",     // definition (cursor here)
  "  concept dog : animal { }", // reference
  "  animal a { }",             // reference (instance concept)
  "}",
].join("\n");

test("prepareRename returns the identifier range at the cursor", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const range = prepareRename(analysis, uri, positions[0]!);
  assert.deepEqual(range, { start: { line: 1, character: 10 }, end: { line: 1, character: 16 } });
});

test("renameEdits rewrites the definition and every reference", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const edit = renameEdits(analysis, uri, positions[0]!, "creature");
  assert.ok(!("error" in edit));
  const edits = (edit as { changes: Record<string, unknown[]> }).changes["d.todl"];
  assert.equal(edits.length, 3);   // definition + 2 references
});

test("renameEdits rejects an invalid name", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const bad = renameEdits(analysis, uri, positions[0]!, "Animal");   // not kebab-case
  assert.ok("error" in bad);
});

test("renameEdits rejects a colliding name", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const clash = renameEdits(analysis, uri, positions[0]!, "dog");   // already defined
  assert.ok("error" in clash);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/rename.test.ts"`
Expected: FAIL — `../rename.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/rename.ts`**

```ts
import type { Range, Position, WorkspaceEdit, TextEdit } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";

export interface RenameError { error: string }

const KEBAB = /^[a-z][a-z0-9-]*$/;

// Resolve the symbol under the cursor — a reference occurrence or a definition
// name — tolerating a cursor on the identifier's trailing edge.
function resolve(a: Analysis, uri: string, pos: Position): { symbol: string; range: Range } | null {
  const back = pos.character > 0 ? { line: pos.line, character: pos.character - 1 } : pos;
  const occ = a.refs.occurrenceAt(uri, pos) ?? a.refs.occurrenceAt(uri, back);
  if (occ !== null && occ.symbol !== "") return { symbol: occ.symbol, range: occ.range };
  const def = a.defs.definitionAt(uri, pos) ?? a.defs.definitionAt(uri, back);
  if (def !== null) return { symbol: def.symbol, range: def.nameRange };
  return null;
}

export function prepareRename(a: Analysis, uri: string, pos: Position): Range | null {
  return resolve(a, uri, pos)?.range ?? null;
}

export function renameEdits(a: Analysis, uri: string, pos: Position, newName: string): WorkspaceEdit | RenameError {
  const target = resolve(a, uri, pos);
  if (target === null) return { error: "Nothing to rename here." };
  if (!KEBAB.test(newName)) return { error: `"${newName}" is not a valid kebab-case name.` };
  if (a.model.has(newName)) return { error: `"${newName}" already exists.` };

  const symbol = target.symbol;
  const edits: { uri: string; edit: TextEdit }[] = [];
  const def = a.defs.get(symbol);
  if (def !== null) edits.push({ uri: def.uri, edit: { range: def.nameRange, newText: newName } });
  for (const occ of a.refs.get(symbol)) edits.push({ uri: occ.uri, edit: { range: occ.range, newText: newName } });

  const changes: Record<string, TextEdit[]> = {};
  for (const { uri: u, edit } of edits) (changes[u] ??= []).push(edit);
  return { changes };
}
```

- [ ] **Step 4: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./rename.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/rename.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/rename.ts src/language-service/index.ts src/language-service/tests/rename.test.ts
git commit -m "feat(language-service): rename (definition + references, validated)"
```

---

### Task 4: Document symbols (outline)

A hierarchical `DocumentSymbol` tree for one file, with `range` (whole decl) and `selectionRange` (name span).

**Files:**
- Create: `src/language-service/document-symbols.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/document-symbols.test.ts`

**Interfaces:**
- Consumes: `Analysis`; the AST (`Declaration`, `DeclKind`); `spanToRange` from `./position.js`; `DocumentSymbol`, `SymbolKind as LspSymbolKind` from `vscode-languageserver-types`.
- Produces: `documentSymbols(a: Analysis, uri: string): DocumentSymbol[]`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/document-symbols.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SymbolKind } from "vscode-languageserver-types";
import { fixture } from "./fixtures.js";
import { documentSymbols } from "../document-symbols.js";

test("outlines concepts with their fields and relationships as children", () => {
  const { analysis, uri } = fixture("d.todl", [
    "namespace demo {",
    "  concept dog { name : string; relationship owner -> person []; }",
    "  dog rex { }",
    "}",
  ].join("\n"));
  const syms = documentSymbols(analysis, uri);
  const names = syms.map((s) => s.name).sort();
  assert.deepEqual(names, ["dog", "rex"]);
  const dog = syms.find((s) => s.name === "dog")!;
  assert.equal(dog.kind, SymbolKind.Class);
  assert.deepEqual(dog.children?.map((c) => c.name).sort(), ["name", "owner"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/document-symbols.test.ts"`
Expected: FAIL — `../document-symbols.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/document-symbols.ts`**

```ts
import { SymbolKind, type DocumentSymbol, type Range } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { spanToRange } from "./position.js";
import {
  DeclKind, type Declaration, type ConceptDecl, type InstanceDecl,
} from "../parse/ast.js";

export function documentSymbols(a: Analysis, uri: string): DocumentSymbol[] {
  const ast = a.sources.get(uri)?.ast;
  if (ast === undefined) return [];
  return ast.declarations.map((d) => toSymbol(d)).filter((s): s is DocumentSymbol => s !== null);
}

function toSymbol(decl: Declaration): DocumentSymbol | null {
  const range = spanToRange(decl.span);
  switch (decl.kind) {
    case DeclKind.Primitive:
      return leaf(decl.name, SymbolKind.Struct, range, nameRange(decl.nameSpan, range));
    case DeclKind.Taxonomy:
      return leaf(decl.name, SymbolKind.Enum, range, nameRange(decl.nameSpan, range));
    case DeclKind.Concept:
      return conceptSymbol(decl, range);
    case DeclKind.Instance:
      return instanceSymbol(decl, range);
  }
}

function conceptSymbol(decl: ConceptDecl, range: Range): DocumentSymbol {
  const children: DocumentSymbol[] = [];
  for (const f of decl.fields) {
    if (f.nameSpan !== undefined) children.push(leaf(f.name, SymbolKind.Field, spanToRange(f.nameSpan), spanToRange(f.nameSpan)));
  }
  for (const r of decl.relationships) {
    if (r.nameSpan !== undefined) children.push(leaf(r.name, SymbolKind.Method, spanToRange(r.nameSpan), spanToRange(r.nameSpan)));
  }
  const sym = leaf(decl.name, SymbolKind.Class, range, nameRange(decl.nameSpan, range));
  if (children.length > 0) sym.children = children;
  return sym;
}

function instanceSymbol(decl: InstanceDecl, range: Range): DocumentSymbol {
  const children = decl.children.map((c) => instanceSymbol(c, spanToRange(c.span)));
  const sym = leaf(decl.id, SymbolKind.Object, range, nameRange(decl.idSpan, range));
  if (children.length > 0) sym.children = children;
  return sym;
}

function leaf(name: string, kind: SymbolKind, range: Range, selectionRange: Range): DocumentSymbol {
  return { name, kind, range, selectionRange };
}

function nameRange(span: { start: unknown } | undefined, fallback: Range): Range {
  return span === undefined ? fallback : spanToRange(span as Parameters<typeof spanToRange>[0]);
}
```

- [ ] **Step 4: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./document-symbols.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/document-symbols.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/document-symbols.ts src/language-service/index.ts src/language-service/tests/document-symbols.test.ts
git commit -m "feat(language-service): document symbols (outline)"
```

---

### Task 5: Folding ranges

Fold multi-line `{ … }` blocks, computed from the token stream.

**Files:**
- Create: `src/language-service/folding.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/folding.test.ts`

**Interfaces:**
- Consumes: `Analysis`; `Token`, `TokenKind` from `src/parse/lexer.js`; `FoldingRange` from `vscode-languageserver-types`.
- Produces: `foldingRanges(a: Analysis, uri: string): FoldingRange[]`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/folding.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { foldingRanges } from "../folding.js";

test("folds a multi-line brace block", () => {
  const { analysis, uri } = fixture("d.todl", [
    "namespace demo {",   // line 0 — opens
    "  concept a {",      // line 1 — opens
    "    name : string;",
    "  }",                // line 3 — closes line 1
    "}",                  // line 4 — closes line 0
  ].join("\n"));
  const ranges = foldingRanges(analysis, uri).sort((x, y) => x.startLine - y.startLine);
  assert.deepEqual(ranges, [
    { startLine: 0, endLine: 3 },
    { startLine: 1, endLine: 2 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/folding.test.ts"`
Expected: FAIL — `../folding.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/folding.ts`**

```ts
import { TokenKind, type Token } from "../parse/lexer.js";
import type { FoldingRange } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";

// One folding range per multi-line `{ … }` block. `endLine` is the last line the
// fold hides — the line before the closing brace — so the brace line stays
// visible when collapsed (the common editor convention).
export function foldingRanges(a: Analysis, uri: string): FoldingRange[] {
  const tokens = a.sources.get(uri)?.tokens ?? [];
  const opens: Token[] = [];
  const ranges: FoldingRange[] = [];
  for (const t of tokens) {
    if (t.kind === TokenKind.LBrace) opens.push(t);
    else if (t.kind === TokenKind.RBrace) {
      const open = opens.pop();
      if (open === undefined) continue;
      const startLine = open.line - 1;      // 0-based
      const endLine = t.line - 1 - 1;       // line before the closing brace
      if (endLine > startLine) ranges.push({ startLine, endLine });
    }
  }
  return ranges;
}
```

- [ ] **Step 4: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./folding.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/folding.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/folding.ts src/language-service/index.ts src/language-service/tests/folding.test.ts
git commit -m "feat(language-service): folding ranges"
```

---

### Task 6: Workspace symbols

Fuzzy-match a query against every defined symbol across the project.

**Files:**
- Create: `src/language-service/workspace-symbols.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/workspace-symbols.test.ts`

**Interfaces:**
- Consumes: `Analysis` (uses `a.defs.all()`); `symbolKindOf` mapping is not needed (definitions carry `kind`); `SymbolKind as LspSymbolKind`, `WorkspaceSymbol` from `vscode-languageserver-types`; the internal `SymbolKind` from `./symbols.js`.
- Produces: `workspaceSymbols(a: Analysis, query: string): WorkspaceSymbol[]`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/workspace-symbols.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../analysis.js";
import { workspaceSymbols } from "../workspace-symbols.js";

test("matches symbols by case-insensitive substring", () => {
  const a = analyze([{ uri: "d.todl", text: [
    "namespace demo {",
    "  concept person { }",
    "  concept product { }",
    "  person alice { }",
    "}",
  ].join("\n") }]);
  const names = workspaceSymbols(a, "per").map((s) => s.name).sort();
  assert.deepEqual(names, ["person"]);
  assert.deepEqual(workspaceSymbols(a, "p").map((s) => s.name).sort(), ["person", "product"]);
  // Location points into the file.
  assert.equal(workspaceSymbols(a, "person")[0]!.location.uri, "d.todl");
});

test("an empty query returns every symbol", () => {
  const a = analyze([{ uri: "d.todl", text: "namespace demo {\n  concept a { }\n}" }]);
  assert.equal(workspaceSymbols(a, "").length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/workspace-symbols.test.ts"`
Expected: FAIL — `../workspace-symbols.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/workspace-symbols.ts`**

```ts
import { SymbolKind as LspSymbolKind, type WorkspaceSymbol } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { SymbolKind } from "./symbols.js";

const TO_LSP: Record<SymbolKind, LspSymbolKind> = {
  [SymbolKind.Concept]: LspSymbolKind.Class,
  [SymbolKind.Primitive]: LspSymbolKind.Struct,
  [SymbolKind.Taxonomy]: LspSymbolKind.Enum,
  [SymbolKind.Term]: LspSymbolKind.EnumMember,
  [SymbolKind.Instance]: LspSymbolKind.Object,
  [SymbolKind.Field]: LspSymbolKind.Field,
  [SymbolKind.Relationship]: LspSymbolKind.Method,
  [SymbolKind.Unknown]: LspSymbolKind.Null,
};

export function workspaceSymbols(a: Analysis, query: string): WorkspaceSymbol[] {
  const needle = query.toLowerCase();
  const out: WorkspaceSymbol[] = [];
  for (const def of a.defs.all()) {
    if (needle !== "" && !def.symbol.toLowerCase().includes(needle)) continue;
    out.push({
      name: def.symbol,
      kind: TO_LSP[def.kind],
      location: { uri: def.uri, range: def.nameRange },
    });
  }
  return out;
}
```

- [ ] **Step 4: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./workspace-symbols.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/workspace-symbols.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/workspace-symbols.ts src/language-service/index.ts src/language-service/tests/workspace-symbols.test.ts
git commit -m "feat(language-service): workspace symbols"
```

---

### Task 7: Semantic tokens

Accurate highlighting: classify every reference + definition identifier by its resolved role, delta-encoded per the LSP spec.

**Files:**
- Create: `src/language-service/semantic-tokens.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/semantic-tokens.test.ts`

**Interfaces:**
- Consumes: `Analysis` (`a.refs.all()`, `a.defs.all()`); `Role` from `./reference-index.js`; `SymbolKind` from `./symbols.js`; `SemanticTokens`, `SemanticTokensLegend` (type only) from `vscode-languageserver-types`.
- Produces:
  - `SEMANTIC_LEGEND: SemanticTokensLegend` (the token-type + modifier names).
  - `semanticTokens(a: Analysis, uri: string): SemanticTokens`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/semantic-tokens.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { semanticTokens, SEMANTIC_LEGEND } from "../semantic-tokens.js";

// Decode the flat [dLine,dChar,len,type,mods] quintuples into absolute tokens.
function decode(data: number[]) {
  const out: { line: number; char: number; len: number; type: string }[] = [];
  let line = 0, char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const dLine = data[i]!, dChar = data[i + 1]!, len = data[i + 2]!, type = data[i + 3]!;
    line += dLine;
    char = dLine === 0 ? char + dChar : dChar;
    out.push({ line, char, len, type: SEMANTIC_LEGEND.tokenTypes[type]! });
  }
  return out;
}

test("classifies a concept reference and definition by role", () => {
  const { analysis, uri } = fixture("d.todl",
    "namespace demo {\n  concept animal { }\n  concept dog : animal { }\n}");
  const toks = decode(semanticTokens(analysis, uri).data);
  // The `animal` reference in `: animal` (0-based line 2, char 16) is a 'type'.
  const ref = toks.find((t) => t.line === 2 && t.char === 16);
  assert.equal(ref?.type, "type");
  assert.equal(ref?.len, 6);
  // The `animal` definition name (line 1) is also typed as a 'type'.
  const def = toks.find((t) => t.line === 1 && t.char === 10);
  assert.equal(def?.type, "type");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/semantic-tokens.test.ts"`
Expected: FAIL — `../semantic-tokens.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/semantic-tokens.ts`**

```ts
import type { SemanticTokens, SemanticTokensLegend, Range } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { Role } from "./reference-index.js";
import { SymbolKind } from "./symbols.js";

// The token-type legend, ordered — the encoded `tokenType` field indexes this.
const TYPES = ["type", "class", "enumMember", "property", "method", "variable"] as const;
export const SEMANTIC_LEGEND: SemanticTokensLegend = { tokenTypes: [...TYPES], tokenModifiers: [] };
const TYPE_INDEX: Record<(typeof TYPES)[number], number> = { type: 0, class: 1, enumMember: 2, property: 3, method: 4, variable: 5 };

// A reference role → token type. Concepts are 'type'; targets are concepts too.
const ROLE_TYPE: Record<Role, (typeof TYPES)[number]> = {
  [Role.Extends]: "type", [Role.FieldType]: "type", [Role.RelationshipTarget]: "type",
  [Role.InstanceConcept]: "type", [Role.InstanceOf]: "type",
  [Role.RefValue]: "variable", [Role.Import]: "class",
};

// A definition kind → token type.
function defType(kind: SymbolKind): (typeof TYPES)[number] {
  switch (kind) {
    case SymbolKind.Concept: return "type";
    case SymbolKind.Primitive: case SymbolKind.Taxonomy: return "class";
    case SymbolKind.Term: return "enumMember";
    case SymbolKind.Field: return "property";
    case SymbolKind.Relationship: return "method";
    default: return "variable";
  }
}

interface Raw { line: number; char: number; len: number; type: number }

export function semanticTokens(a: Analysis, uri: string): SemanticTokens {
  const raws: Raw[] = [];
  for (const occ of a.refs.all()) {
    if (occ.uri !== uri || occ.symbol === "") continue;
    raws.push(toRaw(occ.range, TYPE_INDEX[ROLE_TYPE[occ.role]]));
  }
  for (const def of a.defs.all()) {
    if (def.uri !== uri) continue;
    raws.push(toRaw(def.nameRange, TYPE_INDEX[defType(def.kind)]));
  }
  raws.sort((x, y) => (x.line - y.line) || (x.char - y.char));

  const data: number[] = [];
  let prevLine = 0, prevChar = 0;
  for (const r of raws) {
    const dLine = r.line - prevLine;
    const dChar = dLine === 0 ? r.char - prevChar : r.char;
    data.push(dLine, dChar, r.len, r.type, 0);
    prevLine = r.line; prevChar = r.char;
  }
  return { data };
}

function toRaw(range: Range, type: number): Raw {
  return { line: range.start.line, char: range.start.character, len: range.end.character - range.start.character, type };
}
```

- [ ] **Step 4: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./semantic-tokens.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/semantic-tokens.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/semantic-tokens.ts src/language-service/index.ts src/language-service/tests/semantic-tokens.test.ts
git commit -m "feat(language-service): semantic tokens"
```

---

### Task 8: Schema-context resolver

At an assignment slot inside an instance, resolve the enclosing concept, the member being assigned, and its declared target concept. Shared by `&ref` completion narrowing and signature help.

**Files:**
- Create: `src/language-service/schema-context.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/schema-context.test.ts`

**Interfaces:**
- Consumes: `Analysis`; `Token`, `TokenKind` from `src/parse/lexer.js`; `positionToTodl` from `./position.js`; the AST (`DeclKind`, `InstanceDecl`); `Repository.effectiveSchema`.
- Produces:
  - `interface AssignmentContext { concept: string; member: string; targetConcept: string | null; cardinality: number; isRelationship: boolean }`
  - `assignmentContextAt(a: Analysis, uri: string, pos: Position): AssignmentContext | null`

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/schema-context.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { assignmentContextAt } from "../schema-context.js";

test("resolves the target concept of a relationship assignment", () => {
  const { analysis, positions, uri } = fixture("d.todl", [
    "namespace demo {",
    "  concept person { }",
    "  concept dog { relationship owner -> person []; }",
    "  dog rex { owner = &‸ }",
    "}",
  ].join("\n"));
  const ctx = assignmentContextAt(analysis, uri, positions[0]!);
  assert.equal(ctx?.concept, "dog");
  assert.equal(ctx?.member, "owner");
  assert.equal(ctx?.targetConcept, "person");
  assert.equal(ctx?.isRelationship, true);
});

test("returns null outside any assignment slot", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {‸\n  concept a { }\n}");
  assert.equal(assignmentContextAt(analysis, uri, positions[0]!), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/schema-context.test.ts"`
Expected: FAIL — `../schema-context.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/schema-context.ts`**

```ts
import type { Position } from "vscode-languageserver-types";
import { TokenKind, type Token } from "../parse/lexer.js";
import type { Analysis } from "./analysis.js";
import { positionToTodl } from "./position.js";
import { DeclKind, type Declaration, type InstanceDecl } from "../parse/ast.js";

export interface AssignmentContext {
  concept: string;
  member: string;
  targetConcept: string | null;
  cardinality: number;
  isRelationship: boolean;
}

// Resolve the assignment slot at `pos`: the enclosing instance's concept, the
// member name to its left (`<member> = …`), and that member's declared type or
// relationship target from the effective schema. Null when the cursor is not in
// an `<member> = <value>` position inside an instance body.
export function assignmentContextAt(a: Analysis, uri: string, pos: Position): AssignmentContext | null {
  const file = a.sources.get(uri);
  if (file === undefined) return null;

  const inst = enclosingInstance(a, uri, pos);
  if (inst === null) return null;

  const member = memberBeforeCursor(file.tokens, positionToTodl(pos));
  if (member === null) return null;

  const schema = a.model.effectiveSchema(inst.concept);
  const rel = schema.relationships.find((r) => r.name === member);
  if (rel !== undefined) {
    return { concept: inst.concept, member, targetConcept: rel.target, cardinality: rel.cardinality, isRelationship: true };
  }
  const field = schema.fields.find((f) => f.name === member);
  if (field !== undefined) {
    return { concept: inst.concept, member, targetConcept: field.type, cardinality: field.cardinality, isRelationship: false };
  }
  return { concept: inst.concept, member, targetConcept: null, cardinality: 0, isRelationship: false };
}

// The innermost instance declaration whose span covers `pos` (1-based).
function enclosingInstance(a: Analysis, uri: string, pos: Position): InstanceDecl | null {
  const ast = a.sources.get(uri)?.ast;
  if (ast === undefined) return null;
  const tp = positionToTodl(pos);
  let found: InstanceDecl | null = null;
  const visit = (decl: Declaration): void => {
    if (decl.kind !== DeclKind.Instance) return;
    if (!spanCovers(decl.span, tp.line, tp.column)) return;
    found = decl;
    for (const child of decl.children) visit(child);
  };
  for (const decl of ast.declarations) visit(decl);
  return found;
}

function spanCovers(span: { start: { line: number; column: number }; end: { line: number; column: number } }, line: number, column: number): boolean {
  const afterStart = line > span.start.line || (line === span.start.line && column >= span.start.column);
  const beforeEnd = line < span.end.line || (line === span.end.line && column <= span.end.column);
  return afterStart && beforeEnd;
}

// Scan back from the token nearest `pos` for the `<identifier> =` pattern and
// return the identifier — the member being assigned.
function memberBeforeCursor(tokens: Token[], tp: { line: number; column: number }): string | null {
  // Index of the first token starting at/after the cursor.
  let idx = tokens.findIndex((t) => t.line > tp.line || (t.line === tp.line && t.column >= tp.column));
  if (idx === -1) idx = tokens.length;
  // Walk back to the nearest `=`, then take the identifier just before it.
  for (let i = idx - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t === undefined) continue;
    if (t.kind === TokenKind.Equals) {
      const name = tokens[i - 1];
      return name !== undefined && name.kind === TokenKind.Identifier ? name.value : null;
    }
    // Stop at a statement / block boundary — no assignment in progress.
    if (t.kind === TokenKind.Semicolon || t.kind === TokenKind.LBrace || t.kind === TokenKind.RBrace) return null;
  }
  return null;
}
```

- [ ] **Step 4: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./schema-context.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/schema-context.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/schema-context.ts src/language-service/index.ts src/language-service/tests/schema-context.test.ts
git commit -m "feat(language-service): schema-context resolver for assignment slots"
```

---

### Task 9: Completion `&ref` narrowing

Retire the Foundation limitation: a `&ref` value now offers only instances of the assignment's target concept (and its subtypes).

**Files:**
- Modify: `src/language-service/completion.ts`
- Test: `src/language-service/tests/completion.test.ts` (extend)

**Interfaces:**
- Consumes: `assignmentContextAt` from `./schema-context.js`; `Repository.instancesOf`, `subtypesOf`; the existing completion internals.
- Produces: (unchanged signature) `completionsAt` — `RefValue` results are now narrowed.

- [ ] **Step 1: Write the failing test (extend the completion suite)**

Append to `src/language-service/tests/completion.test.ts`:

```ts
test("a ref-value slot narrows to the target concept's instances (and subtypes), not others", () => {
  const { analysis, positions, uri } = fixture("d.todl", [
    "namespace demo {",
    "  concept animal { }",
    "  concept dog : animal { }",
    "  concept person { }",
    "  concept owns { relationship pet -> animal []; }",
    "  animal generic { }",
    "  dog rex { }",
    "  person alice { }",
    "  owns o { pet = &‸ }",
    "}",
  ].join("\n"));
  const got = completionsAt(analysis, uri, positions[0]!).map((i) => i.label).sort();
  // animal + its subtype dog's instances — NOT the unrelated person `alice`.
  assert.deepEqual(got, ["generic", "rex"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/completion.test.ts"`
Expected: FAIL — the current `refCandidates` offers every instance (including `alice`).

- [ ] **Step 3: Rewrite `refCandidates` in `src/language-service/completion.ts`**

Add the import and replace the function:

```ts
import { assignmentContextAt } from "./schema-context.js";
```

```ts
// A `&ref` value: offer instances of the assignment's target concept and its
// subtypes. Falls back to all instances when the slot's target can't be resolved
// (e.g. the member isn't in the schema).
function refCandidates(a: Analysis, uri: string, pos: Position): CompletionItem[] {
  const ctx = assignmentContextAt(a, uri, pos);
  const ids = ctx?.targetConcept != null ? instancesForConcept(a, ctx.targetConcept) : allInstanceIds(a);
  return ids.map((id) => withDoc({ label: id, kind: CompletionItemKind.Variable }, describe(a, id)));
}

function instancesForConcept(a: Analysis, concept: string): string[] {
  const ids = new Set<string>(a.model.instancesOf(concept));
  for (const sub of a.model.subtypesOf(concept)) for (const i of a.model.instancesOf(sub)) ids.add(i);
  return [...ids];
}

function allInstanceIds(a: Analysis): string[] {
  return a.model.allNodes().filter((n) => symbolKindOf(a.model, n.id) === SymbolKind.Instance).map((n) => n.id);
}
```

and update the `RefValue` case in `completionsAt` to pass the position:

```ts
    case ContextKind.RefValue:
      return refCandidates(a, uri, pos);
```

- [ ] **Step 4: Run the completion suite to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/completion.test.ts"`
Expected: PASS — including the original Foundation ref-value test (its only target-concept instances are `alice`/`bob`).

- [ ] **Step 5: Commit**

```bash
git add src/language-service/completion.ts src/language-service/tests/completion.test.ts
git commit -m "feat(language-service): schema-aware &ref completion narrowing"
```

---

### Task 10: Signature help

While typing an assignment value, show the member's declared type/target and cardinality.

**Files:**
- Create: `src/language-service/signature-help.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/signature-help.test.ts`

**Interfaces:**
- Consumes: `assignmentContextAt` from `./schema-context.js`; `Cardinality` from `src/model/graph.js`; `SignatureHelp` (type only), `SignatureInformation` from `vscode-languageserver-types`.
- Produces: `signatureHelpAt(a: Analysis, uri: string, pos: Position): SignatureHelp | null`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/signature-help.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { signatureHelpAt } from "../signature-help.js";

test("shows the target and cardinality of a relationship assignment", () => {
  const { analysis, positions, uri } = fixture("d.todl", [
    "namespace demo {",
    "  concept person { }",
    "  concept dog { relationship owner -> person []; }",
    "  dog rex { owner = &‸ }",
    "}",
  ].join("\n"));
  const help = signatureHelpAt(analysis, uri, positions[0]!);
  const label = help?.signatures[0]?.label ?? "";
  assert.match(label, /owner/);
  assert.match(label, /person/);
});

test("null outside an assignment slot", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {‸\n  concept a { }\n}");
  assert.equal(signatureHelpAt(analysis, uri, positions[0]!), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/signature-help.test.ts"`
Expected: FAIL — `../signature-help.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/signature-help.ts`**

```ts
import type { SignatureHelp, SignatureInformation } from "vscode-languageserver-types";
import { Cardinality } from "../model/graph.js";
import type { Analysis } from "./analysis.js";
import { assignmentContextAt } from "./schema-context.js";

const CARD: Record<number, string> = {
  [Cardinality.One]: "", [Cardinality.Optional]: "?",
  [Cardinality.Many]: "[]", [Cardinality.NonEmpty]: "[+]",
};

export function signatureHelpAt(a: Analysis, uri: string, pos: Position): SignatureHelp | null {
  const ctx = assignmentContextAt(a, uri, pos);
  if (ctx === null || ctx.targetConcept === null) return null;
  const arrow = ctx.isRelationship ? "->" : ":";
  const label = `${ctx.member} ${arrow} ${ctx.targetConcept}${CARD[ctx.cardinality] ?? ""}`;
  const signature: SignatureInformation = { label };
  return { signatures: [signature], activeSignature: 0, activeParameter: 0 };
}
```

Add the missing `Position` import at the top:

```ts
import type { SignatureHelp, SignatureInformation, Position } from "vscode-languageserver-types";
```

(Combine into the single import line — do not import twice.)

- [ ] **Step 4: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./signature-help.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/signature-help.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/signature-help.ts src/language-service/index.ts src/language-service/tests/signature-help.test.ts
git commit -m "feat(language-service): signature help for assignment slots"
```

---

### Task 11: Code actions — add missing required field

A quick-fix for the `cardinality.required-missing` diagnostic: insert a stub assignment inside the offending instance's body.

**Files:**
- Create: `src/language-service/code-actions.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/code-actions.test.ts`

**Interfaces:**
- Consumes: `Analysis`; `DiagnosticCode` from `src/diagnostics/diagnostic.js`; `Token`, `TokenKind` from `src/parse/lexer.js`; the AST (`DeclKind`, `InstanceDecl`); `spanToRange` from `./position.js`; `CodeAction`, `CodeActionKind`, `Diagnostic`, `Range`, `Position`, `WorkspaceEdit` from `vscode-languageserver-types`.
- Produces: `codeActions(a: Analysis, uri: string, range: Range, diagnostics: Diagnostic[]): CodeAction[]`.

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/code-actions.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../analysis.js";
import { codeActions } from "../code-actions.js";

test("offers to insert a missing required field on the instance", () => {
  const uri = "d.todl";
  const a = analyze([{ uri, text: [
    "namespace demo {",
    "  primitive string { }",
    "  concept person { name : string; }",
    "  person alice { }",
    "}",
  ].join("\n") }]);
  assert.ok(a.diagnostics.length >= 1);
  const actions = codeActions(a, uri, a.diagnostics[0]!.range, a.diagnostics);
  assert.equal(actions.length, 1);
  const edits = actions[0]!.edit!.changes![uri]!;
  assert.equal(edits.length, 1);
  assert.match(edits[0]!.newText, /name = /);
});

test("no actions when there are no fixable diagnostics", () => {
  const uri = "d.todl";
  const a = analyze([{ uri, text: "namespace demo {\n  concept a { }\n}" }]);
  assert.deepEqual(codeActions(a, uri, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, a.diagnostics), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/code-actions.test.ts"`
Expected: FAIL — `../code-actions.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/code-actions.ts`**

```ts
import {
  CodeActionKind, type CodeAction, type Diagnostic, type Range, type Position, type TextEdit,
} from "vscode-languageserver-types";
import { DiagnosticCode } from "../diagnostics/diagnostic.js";
import { TokenKind } from "../parse/lexer.js";
import { DeclKind, type Declaration, type InstanceDecl } from "../parse/ast.js";
import type { Analysis } from "./analysis.js";

export function codeActions(a: Analysis, uri: string, _range: Range, diagnostics: Diagnostic[]): CodeAction[] {
  const actions: CodeAction[] = [];
  for (const diag of diagnostics) {
    if (diag.code !== DiagnosticCode.RequiredMissing) continue;
    const action = addMissingField(a, uri, diag);
    if (action !== null) actions.push(action);
  }
  return actions;
}

// `path` is `<concept>.<field>`; the diagnostic's range starts on the offending
// instance. Insert `\n  <field> = ;` just after that instance's opening brace.
function addMissingField(a: Analysis, uri: string, diag: Diagnostic): CodeAction | null {
  const field = String(diag.code === DiagnosticCode.RequiredMissing ? messageField(diag) : "");
  if (field === "") return null;
  const at = openBracePosition(a, uri, diag.range.start);
  if (at === null) return null;
  const edit: TextEdit = { range: { start: at, end: at }, newText: `\n  ${field} = ;` };
  return {
    title: `Add missing field "${field}"`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diag],
    edit: { changes: { [uri]: [edit] } },
  };
}

// The field name from a required-missing diagnostic. Prefer the structured LSP
// `data`/`code` path when present; here we parse it out of the message tail
// `required "<concept>.<field>" is missing on …`.
function messageField(diag: Diagnostic): string {
  const m = /required\s+"[^".]+\.([^"]+)"/.exec(diag.message);
  return m?.[1] ?? "";
}

// The 0-based position just after the opening `{` of the instance whose record
// starts at `start` (the diagnostic's range start, on the instance line).
function openBracePosition(a: Analysis, uri: string, start: Position): Position | null {
  const file = a.sources.get(uri);
  if (file === undefined) return null;
  const inst = instanceAtLine(file.ast.declarations, start.line + 1);
  if (inst === null) return null;
  // Find the first `{` token at/after the instance's start span.
  for (const t of file.tokens) {
    const afterStart = t.line > inst.span.start.line || (t.line === inst.span.start.line && t.column >= inst.span.start.column);
    if (afterStart && t.kind === TokenKind.LBrace) {
      return { line: t.endLine - 1, character: t.endColumn - 1 };
    }
  }
  return null;
}

function instanceAtLine(decls: Declaration[], line1: number): InstanceDecl | null {
  for (const decl of decls) {
    if (decl.kind !== DeclKind.Instance) continue;
    if (decl.span.start.line === line1) return decl;
    const nested = instanceAtLine(decl.children, line1);
    if (nested !== null) return nested;
  }
  return null;
}
```

- [ ] **Step 4: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./code-actions.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/code-actions.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/code-actions.ts src/language-service/index.ts src/language-service/tests/code-actions.test.ts
git commit -m "feat(language-service): code action — add missing required field"
```

> **Scope note:** this ships one concrete, diagnostic-driven quick-fix (add-missing-required-field). The other actions the spec sketched (create-missing-concept, add-import, fix-name-case, remove-unused-import) depend on diagnostics TODL does not yet emit (an unresolved reference is stubbed to a placeholder, not flagged) and are deferred until those diagnostics exist. This is called out, not silently dropped.

---

### Task 12: Formatting

A comment- and string-aware line reflow: re-indent by brace depth, trim trailing whitespace, collapse blank runs. Idempotent.

**Files:**
- Create: `src/language-service/formatting.ts`
- Modify: `src/language-service/index.ts` (export)
- Test: `src/language-service/tests/formatting.test.ts`

**Interfaces:**
- Consumes: `Analysis` (`a.sources.get(uri).text`); `TextEdit` from `vscode-languageserver-types`.
- Produces:
  - `formatText(text: string): string` (the pure reflow — directly testable for idempotence)
  - `formatDocument(a: Analysis, uri: string): TextEdit[]` (a single full-document `TextEdit`)

- [ ] **Step 1: Write the failing test**

Create `src/language-service/tests/formatting.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatText } from "../formatting.js";

test("re-indents by brace depth and trims trailing space", () => {
  const input = "namespace demo {\nconcept a {\nname : string;   \n}\n}\n";
  const output = formatText(input);
  assert.equal(output, [
    "namespace demo {",
    "  concept a {",
    "    name : string;",
    "  }",
    "}",
    "",
  ].join("\n"));
});

test("is idempotent and preserves comments", () => {
  const input = "namespace demo {\n// a comment\nconcept a { }\n}\n";
  const once = formatText(input);
  assert.equal(formatText(once), once);       // idempotent
  assert.match(once, /\/\/ a comment/);        // comment preserved
});

test("does not treat braces inside strings or comments as blocks", () => {
  const input = 'namespace demo {\nprimitive s { regex = "a{b}c"; }\n}\n';
  const output = formatText(input);
  // The inline `{`/`}` in the string must not change indentation depth.
  assert.equal(output, [
    "namespace demo {",
    '  primitive s { regex = "a{b}c"; }',
    "}",
    "",
  ].join("\n"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/language-service/tests/formatting.test.ts"`
Expected: FAIL — `../formatting.js` does not exist.

- [ ] **Step 3: Implement `src/language-service/formatting.ts`**

```ts
import type { TextEdit, Range } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";

const INDENT = "  ";

// Re-indent each line by its brace depth, trim trailing whitespace, and collapse
// runs of blank lines to one. Only `{`/`}` outside strings and comments drive
// depth, so cardinality `[]` and braces inside literals/comments are inert.
export function formatText(text: string): string {
  const lines = text.split("\n");
  const hadTrailingNewline = text.endsWith("\n");
  if (hadTrailingNewline) lines.pop();   // drop the empty element after the last "\n"

  const out: string[] = [];
  let depth = 0;
  let blankRun = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === "") { blankRun += 1; if (blankRun <= 1) out.push(""); continue; }
    blankRun = 0;
    const startsClosing = trimmed.startsWith("}");
    const indentDepth = Math.max(0, depth - (startsClosing ? 1 : 0));
    out.push(INDENT.repeat(indentDepth) + trimmed);
    depth = Math.max(0, depth + braceDelta(trimmed));
  }

  return out.join("\n") + (hadTrailingNewline ? "\n" : "");
}

export function formatDocument(a: Analysis, uri: string): TextEdit[] {
  const file = a.sources.get(uri);
  if (file === undefined) return [];
  const formatted = formatText(file.text);
  if (formatted === file.text) return [];
  return [{ range: fullRange(file.text), newText: formatted }];
}

// Net `{` minus `}` on a line, ignoring braces inside "…"/"""…"""/`//`/`/* */`.
function braceDelta(line: string): number {
  let delta = 0;
  let i = 0;
  let inString: '"' | null = null;
  while (i < line.length) {
    const ch = line[i]!;
    if (inString !== null) {
      if (ch === inString) inString = null;
      i += 1; continue;
    }
    if (ch === '"') { inString = '"'; i += 1; continue; }
    if (ch === "/" && line[i + 1] === "/") break;                 // line comment — rest ignored
    if (ch === "/" && line[i + 1] === "*") {                      // block comment — skip to */
      const end = line.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 2; continue;
    }
    if (ch === "{") delta += 1;
    else if (ch === "}") delta -= 1;
    i += 1;
  }
  return delta;
}

function fullRange(text: string): Range {
  const lines = text.split("\n");
  const last = lines.length - 1;
  return { start: { line: 0, character: 0 }, end: { line: last, character: lines[last]!.length } };
}
```

- [ ] **Step 4: Export from the barrel (`src/language-service/index.ts`)**

Add: `export * from "./formatting.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/language-service/tests/formatting.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language-service/formatting.ts src/language-service/index.ts src/language-service/tests/formatting.test.ts
git commit -m "feat(language-service): document formatting (comment-aware reflow)"
```

---

### Task 13: Public-surface + full-suite gate

Confirm the advanced surface exports cleanly and the whole repo is green under strict tsc.

**Files:**
- Modify: `src/language-service/tests/public-api.test.ts` (extend)

- [ ] **Step 1: Extend the public smoke test**

Append to `src/language-service/tests/public-api.test.ts`:

```ts
import {
  renameEdits, prepareRename, documentSymbols, foldingRanges, workspaceSymbols,
  semanticTokens, signatureHelpAt, codeActions, formatDocument,
} from "../index.js";

test("the public barrel exposes the advanced surface", () => {
  for (const fn of [renameEdits, prepareRename, documentSymbols, foldingRanges,
    workspaceSymbols, semanticTokens, signatureHelpAt, codeActions, formatDocument]) {
    assert.equal(typeof fn, "function");
  }
});
```

- [ ] **Step 2: Run the language-service suite**

Run: `npx tsx --conditions=development --test "src/language-service/**/*.test.ts"`
Expected: PASS — every language-service test.

- [ ] **Step 3: Run the FULL suite**

Run: `npm test`
Expected: PASS — the whole repo (no regression from Task 1's parser change).

- [ ] **Step 4: Typecheck (strict)**

Run: `npx tsc --noEmit`
Expected: no errors. (Watch `noUncheckedIndexedAccess` on `tokens[i]`/`arr[i]` and `exactOptionalPropertyTypes` on optional result fields — guard or omit, never assign `undefined`.)

- [ ] **Step 5: Commit**

```bash
git add src/language-service/tests/public-api.test.ts
git commit -m "test(language-service): advanced public-surface + full-suite gate"
```

---

## Self-Review

**1. Spec coverage (advanced slice):**
- Rename (+ prepareRename, kebab/collision validation) → Task 3. ✓
- Document symbols → Task 4. ✓
- Folding → Task 5. ✓
- Workspace symbols → Task 6. ✓
- Semantic tokens (legend + delta encoding) → Task 7. ✓
- Schema-aware `&ref` completion narrowing → Tasks 8–9 (retires the Foundation limitation). ✓
- Signature help → Tasks 8, 10. ✓
- Code actions → Task 11 (one concrete diagnostic-driven fix; the placeholder-dependent ones deferred, flagged). ✓
- Formatting → Task 12. ✓
- Enabling substrate (definition name spans, definition index, source text) → Tasks 1–2. ✓
- Definition-into-base go-to-def boundary: unchanged from Foundation (out of this slice).

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". The single deferred item (extra code actions) is named explicitly with its reason (diagnostics don't yet exist).

**3. Type consistency:** `Definition`/`DefinitionIndex` (Task 2) are consumed with the same shape in rename (Task 3), workspace-symbols (Task 6), and semantic-tokens (Task 7). `AssignmentContext`/`assignmentContextAt` (Task 8) are consumed identically in completion (Task 9) and signature-help (Task 10). `Analysis.sources` gaining `text` (Task 2) is what formatting (Task 12) and code-actions (Task 11) read. `SEMANTIC_LEGEND.tokenTypes` ordering matches the encoded indices in Task 7's test decoder. `Role` values referenced in `ROLE_TYPE` (Task 7) match the `enum Role` from the Foundation reference index. AST fields added in Task 1 (`nameSpan`/`idSpan`) match their consumers in Tasks 2 and 4.
