# TODL Taxonomy Kind (SP-Tax1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TODL's `enum` meta-kind with a first-class `taxonomy` meta-kind (a named tree of terms), migrating all existing enums to flat depth-1 taxonomies with zero behavior change.

**Architecture:** A taxonomy is an Ontology-tier node (`typeOf="taxonomy"`); its terms are Ontology-tier nodes typed by the taxonomy, linked parent→child by a new `EdgeKind.Narrower`. Terms reuse the exact node shape enum cases have today (taxonomy-qualified id `tax.term`, `label`/`description` attrs). Hierarchy queries reuse the existing `closure()` machinery. Phased: add `taxonomy` alongside `enum` → migrate files/fixtures/rewriter → remove `enum` → conformance gate.

**Tech Stack:** TypeScript (strict ESM), `@pragmatic-tech-ai/todl`. Test runner: `tsx --conditions=development --test "src/**/*.test.ts"` (globs `tests/` subfolders).

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source (`src/parse/tests/…`), never beside it.
- Real TS enums, never string-literal unions (`MetaKind`/`EdgeKind`/`DeclKind` stay `enum`s).
- Behavior-preserving: after migration, `check(test_project)` yields the identical diagnostic set (the 81 model diagnostics, 0 meta) and resolutions it does today.
- Aliases (`aliases = [...]`) are parsed-and-dropped today (no resolver reads them); they STAY dropped under parity — not in scope.
- Run the full suite with `npx tsx --conditions=development --test "src/**/*.test.ts"`; a single file with `npx tsx --conditions=development --test <path>`. Typecheck with `npx tsc --noEmit`.
- Commits: author `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message body ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. (Per the repo's workflow, actual pushing waits for an explicit "build and promote"; local commits per task are fine.)
- The migrated `.todl` files under `test_migration/test_project/…/enums/` live OUTSIDE the TODL git repo (they're in `test_migration/`, not version-controlled here). Edit them in place; they're loaded by the conformance gate.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/model/graph.ts` | Graph store, `EdgeKind`, `Tier` | Add `EdgeKind.Narrower` |
| `src/model/kinds.ts` | `MetaKind` | Add `Taxonomy`; (Task 6) remove `Enum` |
| `src/model/model.ts` | `Repository` facade | Add `narrowerOf`/`broaderOf`/`descendantsOf`/`ancestorsOf` |
| `src/parse/ast.ts` | Parse AST | Add `DeclKind.Taxonomy`, `Term`, `TaxonomyDecl`; (Task 6) remove `Enum`/`EnumCase`/`EnumDecl` |
| `src/parse/parser.ts` | Recursive-descent parser | Add `parseTaxonomy`/`parseTerms`, dispatch; (Task 6) remove `parseEnum`/`parseEnumValues` |
| `src/model/builder.ts` | Staging builder | Add `TermInput`, `defineTaxonomy`; (Task 6) remove `EnumCaseInput`/`defineEnum` |
| `src/parse/loader.ts` | AST → graph | Dispatch `TaxonomyDecl`; (Task 6) remove `Enum` cases |
| `src/emit/js-module.ts` | Legacy JS-module emit | `emitTaxonomy`, `taxonomies:` registry; (Task 6) drop enum |
| `src/emit/json.ts` | Portable JSON emit | No code change (Narrower rides `EdgeKind`); test only |
| `src/migrate/rewriter.ts` | Legacy→new rewriter | Add `enum`→`taxonomy`, `values`→`terms` |
| `src/index.ts` | Public API | Export `TermInput` (was `EnumCaseInput`) |
| `test_migration/test_project/meta-models/enterprise-architecture/enums/*.todl` | EA classification (17 files) | `enum`→`taxonomy`, `values`→`terms` |
| Test fixtures (`js-module`, `faithfulness`, `loader`, `parser`) | Inline `enum` strings | Migrate to `taxonomy` syntax |

**Note on §4 (validation):** `src/validate/validate.ts` never references `MetaKind.Enum` or enum membership (a taxonomy-typed value resolves to a term node identically to an enum case). It needs **no change**; parity is by construction and proven by Task 7's conformance gate.

---

## Task 1: Graph primitives + Repository hierarchy queries

**Files:**
- Modify: `src/model/graph.ts` (`EdgeKind`, ~line 26)
- Modify: `src/model/kinds.ts` (`MetaKind`, line 6)
- Modify: `src/model/model.ts` (add four query methods after `supertypesOf`, ~line 140)
- Test: `src/model/tests/taxonomy-queries.test.ts` (create)

**Interfaces:**
- Produces: `EdgeKind.Narrower`; `MetaKind.Taxonomy = "taxonomy"`; `Repository.narrowerOf(term): NodeId[]`, `broaderOf(term): NodeId[]`, `descendantsOf(term): NodeId[]`, `ancestorsOf(term): NodeId[]`.

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/taxonomy-queries.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, EdgeKind, Tier } from "../graph.js";
import { MetaKind } from "../kinds.js";
import { Repository } from "../model.js";

// Build a 3-level taxonomy by hand: root -> mid -> leaf, plus a sibling leaf.
function taxo(): Repository {
  const g = new Graph();
  g.addNode({ id: "cc", tier: Tier.Ontology, typeOf: MetaKind.Taxonomy, attrs: new Map() });
  for (const id of ["cc.surface", "cc.api-service", "cc.web-portal", "cc.data-store"])
    g.addNode({ id, tier: Tier.Ontology, typeOf: "cc", attrs: new Map() });
  // surface -> {api-service, web-portal}; broader -> narrower
  g.addEdge({ kind: EdgeKind.Narrower, via: null, from: "cc.surface", to: "cc.api-service" });
  g.addEdge({ kind: EdgeKind.Narrower, via: null, from: "cc.surface", to: "cc.web-portal" });
  return new Repository(g);
}

test("narrowerOf returns direct children; broaderOf the direct parent", () => {
  const m = taxo();
  assert.deepEqual(m.narrowerOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
  assert.deepEqual(m.broaderOf("cc.api-service"), ["cc.surface"]);
  assert.deepEqual(m.narrowerOf("cc.api-service"), []);
});

test("descendantsOf/ancestorsOf walk the whole branch; flat terms return empty", () => {
  const m = taxo();
  assert.deepEqual(m.descendantsOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
  assert.deepEqual(m.ancestorsOf("cc.api-service"), ["cc.surface"]);
  assert.deepEqual(m.descendantsOf("cc.data-store"), []); // flat/root term
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/taxonomy-queries.test.ts`
Expected: FAIL — `EdgeKind.Narrower` undefined / `MetaKind.Taxonomy` undefined / `narrowerOf is not a function`.

- [ ] **Step 3: Add `EdgeKind.Narrower`**

In `src/model/graph.ts`, add `Narrower` to the `EdgeKind` enum (append after `Derived`):

```ts
export enum EdgeKind {
  TypeOf,
  Extends,
  Contains,
  HasField,
  HasRelationship,
  HasInvariant,
  Relationship,
  Derived,
  Narrower, // taxonomy hierarchy: broader term -> narrower term
}
```

- [ ] **Step 4: Add `MetaKind.Taxonomy`**

In `src/model/kinds.ts`, add `Taxonomy` (keep `Enum` for now — removed in Task 6):

```ts
export enum MetaKind {
  Concept = "concept",
  Primitive = "primitive",
  Enum = "enum",
  Taxonomy = "taxonomy",
  Field = "field",
  Relationship = "relationship",
}
```

- [ ] **Step 5: Add the four queries to `Repository`**

In `src/model/model.ts`, after `supertypesOf` (~line 140), add:

```ts
  /** Direct child terms of a taxonomy term (one level narrower). */
  narrowerOf(term: NodeId): NodeId[] {
    return this.graph.related(term, EdgeKind.Narrower, Direction.Out);
  }

  /** Direct parent term(s) of a taxonomy term (one level broader). */
  broaderOf(term: NodeId): NodeId[] {
    return this.graph.related(term, EdgeKind.Narrower, Direction.In);
  }

  /** Every term transitively narrower than `term` (its whole branch). */
  descendantsOf(term: NodeId): NodeId[] {
    return this.graph.closure(term, EdgeKind.Narrower, Direction.Out, false);
  }

  /** Every term transitively broader than `term` (its path to the root). */
  ancestorsOf(term: NodeId): NodeId[] {
    return this.graph.closure(term, EdgeKind.Narrower, Direction.In, false);
  }
```

(`EdgeKind` and `Direction` are already imported in `model.ts`.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/taxonomy-queries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit` (clean) and `npx tsx --conditions=development --test "src/**/*.test.ts"` (all green — enum path untouched).

- [ ] **Step 8: Commit**

```bash
git add src/model/graph.ts src/model/kinds.ts src/model/model.ts src/model/tests/taxonomy-queries.test.ts
git commit -m "feat(model): taxonomy graph primitives — Narrower edge, Taxonomy kind, hierarchy queries"
```

---

## Task 2: Parse `taxonomy` / `terms` (AST + parser)

**Files:**
- Modify: `src/parse/ast.ts` (add `DeclKind.Taxonomy`, `Term`, `TaxonomyDecl`; add to `Declaration` union)
- Modify: `src/parse/parser.ts` (dispatch ~line 164; add `parseTaxonomy`/`parseTerms`)
- Test: `src/parse/tests/taxonomy-parse.test.ts` (create)

**Interfaces:**
- Consumes: parser helpers `startToken()`, `checkKeyword()`, `expectKeyword()`, `expectIdentifier()`, `readStringMember()`, `spanFrom()`, `check(TokenKind.Pipe)`, `advance()`, `expect(TokenKind.LBrace|RBrace)`.
- Produces: `DeclKind.Taxonomy`; `interface Term { id; label; description; children: Term[]; span }`; `interface TaxonomyDecl { kind: DeclKind.Taxonomy; name; description; terms: Term[]; span }`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/taxonomy-parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type TaxonomyDecl } from "../ast.js";

function taxonomy(src: string): TaxonomyDecl {
  const ns = parse({ uri: "t.todl", text: `namespace n {\n${src}\n}` }).namespace;
  const decl = ns.declarations.find((d) => d.kind === DeclKind.Taxonomy);
  assert.ok(decl, "expected a taxonomy declaration");
  return decl as TaxonomyDecl;
}

test("flat taxonomy parses terms with label/description", () => {
  const t = taxonomy(`taxonomy color { terms { | red { label = "Red"; } | blue { label = "Blue"; } } }`);
  assert.equal(t.name, "color");
  assert.deepEqual(t.terms.map((x) => x.id), ["red", "blue"]);
  assert.equal(t.terms[0].label, "Red");
  assert.deepEqual(t.terms[0].children, []);
});

test("nested taxonomy parses child terms mixed with attributes", () => {
  const t = taxonomy(`taxonomy cc {
    terms {
      | surface { label = "Surface"; | api-service { label = "API"; } | web-portal {} }
      | data-store {}
    }
  }`);
  assert.deepEqual(t.terms.map((x) => x.id), ["surface", "data-store"]);
  const surface = t.terms[0];
  assert.equal(surface.label, "Surface");
  assert.deepEqual(surface.children.map((c) => c.id), ["api-service", "web-portal"]);
  assert.deepEqual(t.terms[1].children, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/taxonomy-parse.test.ts`
Expected: FAIL — `DeclKind.Taxonomy` undefined / parser throws "expected a declaration".

- [ ] **Step 3: Add AST types**

In `src/parse/ast.ts`, add `Taxonomy` to `DeclKind` (keep `Enum` for now):

```ts
export enum DeclKind {
  Primitive,
  Enum,
  Taxonomy,
  Concept,
  Instance,
}
```

Add the `Term` and `TaxonomyDecl` interfaces near `EnumDecl` (after line 130):

```ts
export interface Term {
  id: string;
  label: string;
  description: string;
  children: Term[];
  span: SourceSpan;
}

export interface TaxonomyDecl {
  kind: DeclKind.Taxonomy;
  name: string;
  description: string;
  terms: Term[];
  span: SourceSpan;
}
```

Add `TaxonomyDecl` to the `Declaration` union (line 141):

```ts
export type Declaration = ConceptDecl | EnumDecl | TaxonomyDecl | PrimitiveDecl | InstanceDecl;
```

- [ ] **Step 4: Add parser dispatch + methods**

In `src/parse/parser.ts`, add a dispatch line in `parseDeclaration` after the `enum` line (line 164):

```ts
    if (this.checkKeyword("taxonomy")) return this.parseTaxonomy(start);
```

Add the two methods next to `parseEnum` (after `parseEnumValues`, ~line 366). Import `Term`, `TaxonomyDecl` in the ast import block at the top:

```ts
  private parseTaxonomy(start: Token): TaxonomyDecl {
    this.expectKeyword("taxonomy");
    const name = this.expectIdentifier();
    let description = "";
    const terms: Term[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      if (this.checkKeyword("terms")) {
        this.expectKeyword("terms");
        this.expect(TokenKind.LBrace);
        this.parseTerms(terms);
        this.expect(TokenKind.RBrace);
      } else {
        const [key, value] = this.readStringMember();
        if (key === "description" && value !== null) description = value;
      }
    }
    this.expect(TokenKind.RBrace);
    return { kind: DeclKind.Taxonomy, name, description, terms, span: this.spanFrom(start) };
  }

  // Parse a run of `| id { … }` term rows into `out`. A term body mixes
  // `key = value;` attributes and nested `| child { … }` rows; the leading
  // `|` distinguishes a child term from an attribute, at every depth.
  private parseTerms(out: Term[]): void {
    while (this.check(TokenKind.Pipe)) {
      const start = this.startToken();
      this.advance();
      const id = this.expectIdentifier();
      let label = "";
      let description = "";
      const children: Term[] = [];
      this.expect(TokenKind.LBrace);
      while (!this.check(TokenKind.RBrace)) {
        if (this.check(TokenKind.Pipe)) {
          this.parseTerms(children);
        } else {
          const [key, value] = this.readStringMember();
          if (key === "label" && value !== null) label = value;
          else if (key === "description" && value !== null) description = value;
        }
      }
      this.expect(TokenKind.RBrace);
      out.push({ id, label, description, children, span: this.spanFrom(start) });
    }
  }
```

Also add `taxonomy` to the top-level keyword guard if one exists (parser.ts ~line 101-106 lists `primitive`/`enum`/`concept`/…); add `|| this.checkKeyword("taxonomy")` there so a top-level `taxonomy` is recognized as a declaration start.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test src/parse/tests/taxonomy-parse.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit` and the full suite. All green (enum path intact).

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/taxonomy-parse.test.ts
git commit -m "feat(parse): recursive taxonomy/terms parsing into TaxonomyDecl"
```

---

## Task 3: Build + load taxonomies (builder + loader)

**Files:**
- Modify: `src/model/builder.ts` (add `TermInput`, `defineTaxonomy`; keep `EnumCaseInput`/`defineEnum`)
- Modify: `src/parse/loader.ts` (dispatch `DeclKind.Taxonomy` in the three `switch` sites: build ~line 51, staging-order ~line 117, spans ~line 141)
- Test: `src/parse/tests/taxonomy-load.test.ts` (create)

**Interfaces:**
- Consumes: `Term` (Task 2), `Repository` queries (Task 1), `Builder.stageNode`, `stagedNodes`, `stagedEdges`.
- Produces: `interface TermInput { id; label?; description?; children?: TermInput[] }`; `Builder.defineTaxonomy(name: NodeId, terms: readonly TermInput[]): this` — stages the taxonomy node + one Ontology node per term (`typeOf=name`, id `name.termId`) + a `Narrower` edge per parent→child.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/taxonomy-load.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { MetaKind } from "../../model/kinds.js";

function repo(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).model;
}

test("a flat taxonomy loads terms typed by the taxonomy, no Narrower edges", () => {
  const m = repo(`taxonomy color { terms { | red { label = "Red"; } | blue {} } }`);
  assert.equal(m.resolve("color")?.typeOf, MetaKind.Taxonomy);
  assert.equal(m.resolve("color.red")?.typeOf, "color");
  assert.equal(m.resolve("color.red")?.attrs.get("label"), "Red");
  assert.deepEqual(m.narrowerOf("color.red"), []);
});

test("a nested taxonomy loads Narrower edges and answers branch queries", () => {
  const m = repo(`taxonomy cc { terms { | surface { | api-service {} | web-portal {} } | data-store {} } }`);
  assert.deepEqual(m.narrowerOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
  assert.deepEqual(m.broaderOf("cc.api-service"), ["cc.surface"]);
  assert.deepEqual(m.descendantsOf("cc.surface").sort(), ["cc.api-service", "cc.web-portal"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/taxonomy-load.test.ts`
Expected: FAIL — loader doesn't handle `DeclKind.Taxonomy` / `defineTaxonomy` missing.

- [ ] **Step 3: Add `TermInput` + `defineTaxonomy` to the builder**

In `src/model/builder.ts`, add near `EnumCaseInput` (line 18):

```ts
/** A taxonomy term: display metadata + zero-or-more nested child terms. */
export interface TermInput {
  id: NodeId;
  label?: string;
  description?: string;
  children?: readonly TermInput[];
}
```

Add the method next to `defineEnum` (after line 143):

```ts
  /**
   * Stage a taxonomy: the taxonomy node plus one Ontology node per term
   * (typed by the taxonomy, id `taxonomy.term`), plus a `Narrower` edge from
   * each parent term to each child term. Terms nest arbitrarily; top-level
   * terms are roots (no incoming Narrower edge).
   */
  defineTaxonomy(name: NodeId, terms: readonly TermInput[]): this {
    this.stageNode(name, Tier.Ontology, MetaKind.Taxonomy);
    const stageTerm = (term: TermInput, parentId: NodeId | null): void => {
      const id = `${name}.${term.id}`;
      const attrs = new Map<string, Scalar>([["id", term.id]]);
      if (term.label !== undefined) attrs.set("label", term.label);
      if (term.description !== undefined) attrs.set("description", term.description);
      this.stagedNodes.push({ id, tier: Tier.Ontology, typeOf: name, attrs });
      if (parentId !== null) {
        this.stagedEdges.push({ kind: EdgeKind.Narrower, via: null, from: parentId, to: id });
      }
      for (const child of term.children ?? []) stageTerm(child, id);
    };
    for (const term of terms) stageTerm(term, null);
    return this;
  }
```

(Confirm `stagedEdges` is the builder's edge-staging array — it is, per the `StagedEdge` interface at builder.ts:30. `EdgeKind` and `Scalar` are already imported.)

- [ ] **Step 4: Wire the loader**

In `src/parse/loader.ts`, import `TermInput` alongside `EnumCaseInput` (line 16), and add a `DeclKind.Taxonomy` case to each of the three switches:

Build switch (~line 51-65), after the `DeclKind.Enum` case:

```ts
      case DeclKind.Taxonomy: {
        const toTerm = (t: Term): TermInput => ({
          id: t.id,
          label: t.label || undefined,
          description: t.description || undefined,
          children: t.children.map(toTerm),
        });
        first.defineTaxonomy(declaration.name, declaration.terms.map(toTerm));
        break;
      }
```

Staging-order switch (~line 117-123, where `Primitive`/`Enum`/`Concept` are grouped): add `case DeclKind.Taxonomy:` to the same group as `DeclKind.Enum`.

Span switch (~line 141-152): add a `DeclKind.Taxonomy` case mirroring the `DeclKind.Enum` span-recording, walking terms recursively so each term's qualified id (`name.termId`) gets its `term.span` recorded:

```ts
    case DeclKind.Taxonomy: {
      model.recordSpan(declaration.name, declaration.span);
      const record = (t: Term): void => {
        model.recordSpan(`${declaration.name}.${t.id}`, t.span);
        t.children.forEach(record);
      };
      declaration.terms.forEach(record);
      break;
    }
```

Import `Term` from `./ast.js` in loader.ts if not already imported.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test src/parse/tests/taxonomy-load.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + full suite**

`npx tsc --noEmit` clean; full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/model/builder.ts src/parse/loader.ts src/parse/tests/taxonomy-load.test.ts
git commit -m "feat(model): defineTaxonomy builder + loader wiring for taxonomy declarations"
```

---

## Task 4: Emit (js-module retarget + JSON round-trip test)

**Files:**
- Modify: `src/emit/js-module.ts` (`emitEnum`→`emitTaxonomy`, `instancesOf(Enum)`→`instancesOf(Taxonomy)`, registry `enums:`→`taxonomies:`)
- Test: `src/emit/tests/taxonomy-json.test.ts` (create) — JSON round-trip of Narrower
- Test: `src/emit/tests/js-module.test.ts` (modify — assert taxonomy shape)

**Interfaces:**
- Consumes: `model.instancesOf(MetaKind.Taxonomy)`, `model.narrowerOf`, `model.broaderOf`, `toJSON`/`fromJSON`.
- Produces: emitted `export const <Pascal> = { slug, terms: { <bare>: { id, label?, description?, parent, children } }, has() }`; registry `taxonomies: { … }`.

- [ ] **Step 1: Write the failing JSON round-trip test**

Create `src/emit/tests/taxonomy-json.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../../parse/loader.js";
import { toJSON, fromJSON } from "../json.js";

test("toJSON/fromJSON round-trips a nested taxonomy including Narrower edges", () => {
  const src = `namespace n { taxonomy cc { terms { | surface { | api-service {} } | data-store {} } } }`;
  const original = load([{ uri: "t.todl", text: src }]).model;
  const rebuilt = fromJSON(toJSON(original));
  assert.deepEqual(rebuilt.narrowerOf("cc.surface"), ["cc.api-service"]);
  assert.deepEqual(rebuilt.broaderOf("cc.api-service"), ["cc.surface"]);
  assert.equal(rebuilt.resolve("cc")?.typeOf, "taxonomy");
});
```

- [ ] **Step 2: Run to verify it passes already (JSON is generic)**

Run: `npx tsx --conditions=development --test src/emit/tests/taxonomy-json.test.ts`
Expected: PASS — `toJSON` writes `EdgeKind[kind]` (now includes `Narrower`) and `fromJSON` maps it back generically. This test guards that the generic path keeps working; no json.ts edit needed. If it FAILS, it means `EdgeKind.Narrower` wasn't added in Task 1 — fix there.

- [ ] **Step 3: Write the failing js-module test**

In `src/emit/tests/js-module.test.ts`, add (adapt to the file's existing `toMetaModule` harness/imports):

```ts
test("emits a taxonomy table and a taxonomies registry key", () => {
  const src = `namespace n { taxonomy cc { terms { | surface { label = "Surface"; | api-service { label = "API"; } } } } }`;
  const model = load([{ uri: "t.todl", text: src }]).model;
  const js = toMetaModule(model, { slug: "n" });
  assert.match(js, /export const Cc = \{/);
  assert.match(js, /terms: \{/);
  assert.match(js, /"api-service": \{[^}]*parent: "surface"/);
  assert.match(js, /taxonomies: \{/);
  assert.doesNotMatch(js, /enums: \{/);
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/emit/tests/js-module.test.ts`
Expected: FAIL — emitter still emits `enums:` / has no `terms:` table.

- [ ] **Step 5: Retarget the js-module emitter**

In `src/emit/js-module.ts`:
- Line 41: `const enums = [...model.instancesOf(MetaKind.Enum)].sort();` → `const taxonomies = [...model.instancesOf(MetaKind.Taxonomy)].sort();` (rename the local + its uses at lines ~63-70 and in `emitRegistry`).
- Rename `emitEnum` → `emitTaxonomy` and change its body to emit a `terms` table (was `values`), each term carrying `id`, optional `label`/`description`, `parent` (bare id of `broaderOf` or `null`), and `children` (bare ids of `narrowerOf`). Keep the `has()` helper verbatim. Bare id = `node.attrs.get("id")`; strip the `taxonomy.` qualifier when reading parent/children:

```ts
function emitTaxonomy(model: Repository, taxonomyId: string): string {
  const name = pascalCase(taxonomyId);
  const i = "    ";
  const bare = (qualified: string): string => {
    const node = model.resolve(qualified);
    const id = node?.attrs.get("id");
    return typeof id === "string" ? id : qualified.slice(taxonomyId.length + 1);
  };
  const lines: string[] = [`export const ${name} = {`];
  lines.push(`${i}slug: ${jsStr(taxonomyId)},`);
  lines.push(`${i}terms: {`);
  for (const termId of model.instancesOf(taxonomyId)) {
    const node = model.resolve(termId);
    const id = typeof node?.attrs.get("id") === "string" ? (node!.attrs.get("id") as string) : termId;
    const parts = [`id: ${jsStr(id)}`];
    const label = node?.attrs.get("label");
    if (typeof label === "string") parts.push(`label: ${jsStr(label)}`);
    const description = node?.attrs.get("description");
    if (typeof description === "string") parts.push(`description: ${jsStr(description)}`);
    const parent = model.broaderOf(termId)[0];
    parts.push(`parent: ${parent === undefined ? "null" : jsStr(bare(parent))}`);
    const children = model.narrowerOf(termId).map(bare);
    parts.push(`children: [${children.map(jsStr).join(", ")}]`);
    lines.push(`${i}${i}${jsKey(id)}: { ${parts.join(", ")} },`);
  }
  lines.push(`${i}},`);
  // has() — flag-combo membership, ported verbatim from the enum emitter.
  lines.push(`${i}has(value, member) {`);
  lines.push(`${i}${i}if (value == null) return false;`);
  lines.push(`${i}${i}if (Array.isArray(value)) return value.includes(member);`);
  lines.push(`${i}${i}if (typeof value === 'string') {`);
  lines.push(`${i}${i}${i}return value.split(/[|+,]/).map(s => s.trim()).includes(member);`);
  lines.push(`${i}${i}}`);
  lines.push(`${i}${i}return value === member;`);
  lines.push(`${i}},`);
  lines.push("};");
  return lines.join("\n");
}
```

- In `emitRegistry`, rename the `enums:` block to `taxonomies:` (iterate `taxonomies`, emit `${jsKey(id)}: ${pascalCase(id)},`), and update the section header comment `// ── Enums ──` → `// ── Taxonomies ──`.

- [ ] **Step 6: Run to verify both emit tests pass**

Run: `npx tsx --conditions=development --test src/emit/tests/js-module.test.ts src/emit/tests/taxonomy-json.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + full suite**

`npx tsc --noEmit`; full suite. (Existing `js-module.test.ts` enum-shape assertions may still reference `enums:` — those fixtures get migrated in Task 5; if they fail here because they still author `enum`, that is expected and fixed next task. Prefer to migrate that fixture's authored source to `taxonomy` now if it blocks — see Task 5 Step 3.)

- [ ] **Step 8: Commit**

```bash
git add src/emit/js-module.ts src/emit/tests/taxonomy-json.test.ts src/emit/tests/js-module.test.ts
git commit -m "feat(emit): taxonomy tables in js-module; JSON round-trips Narrower edges"
```

---

## Task 5: Migrate the rewriter, meta-model files, and test fixtures to `taxonomy`

**Files:**
- Modify: `src/migrate/rewriter.ts` (add `enum`→`taxonomy`, `values`→`terms` swaps)
- Modify (data): `test_migration/test_project/meta-models/enterprise-architecture/enums/*.todl` (17 files)
- Modify (fixtures): `src/parse/tests/parser.test.ts`, `src/parse/tests/loader.test.ts`, `src/emit/tests/js-module.test.ts`, `src/migrate/tests/faithfulness.test.ts` — any inline `enum … { values … }` → `taxonomy … { terms … }`
- Test: `src/migrate/tests/rewriter.test.ts` (add a case)

**Interfaces:**
- Consumes: `rewrite(legacySource: string): string` (Task-independent existing function).
- Produces: rewriter output uses `taxonomy`/`terms`; on-disk EA classification files use taxonomy syntax.

- [ ] **Step 1: Write the failing rewriter test**

In `src/migrate/tests/rewriter.test.ts`, add:

```ts
test("rewrites legacy enum/values to taxonomy/terms", () => {
  const out = rewrite(`enum color {\n  values {\n    | red { label = "Red"; }\n  }\n}`);
  assert.match(out, /taxonomy color \{/);
  assert.match(out, /terms \{/);
  assert.doesNotMatch(out, /\benum\b/);
  assert.doesNotMatch(out, /\bvalues\b/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/migrate/tests/rewriter.test.ts`
Expected: FAIL — output still contains `enum`/`values`.

- [ ] **Step 3: Add the rewriter swaps**

In `src/migrate/rewriter.ts`, add a step to `rewrite` and a helper (keyword-boundary swaps; `enum`/`values` are keywords, so `\b` word boundaries are safe):

```ts
export function rewrite(legacySource: string): string {
  let out = legacySource;
  out = rewriteReferences(out);
  out = rewriteListTypes(out);
  out = rewriteCardinality(out);
  out = rewriteEnumToTaxonomy(out);
  return out;
}

/** `enum X { values { … } }` → `taxonomy X { terms { … } }` (keyword swaps). */
function rewriteEnumToTaxonomy(source: string): string {
  return source.replace(/\benum\b/g, "taxonomy").replace(/\bvalues\b/g, "terms");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/migrate/tests/rewriter.test.ts`
Expected: PASS.

- [ ] **Step 5: Migrate the 17 EA enum files on disk**

Run (Git Bash), swapping the keywords in place across the enum files:

```bash
cd /c/Users/Eugene/Projects/architecture-agent/test_migration/test_project/meta-models/enterprise-architecture/enums
for f in *.todl; do sed -i -E 's/\benum\b/taxonomy/g; s/\bvalues\b/terms/g' "$f"; done
grep -l "enum \|values" *.todl || echo "all 17 migrated"
```

Expected: `all 17 migrated`. Spot-check one: `head -6 component-category.todl` shows `taxonomy component-category {` and `terms {`.

- [ ] **Step 6: Migrate inline `enum` fixtures in the 4 test files**

In each of `src/parse/tests/parser.test.ts`, `src/parse/tests/loader.test.ts`, `src/emit/tests/js-module.test.ts`, `src/migrate/tests/faithfulness.test.ts`, replace any inline authored `enum <name> { values { … } }` with `taxonomy <name> { terms { … } }`, and update assertions that referenced `DeclKind.Enum`/`typeOf === "enum"`/`enums:` to their taxonomy equivalents (`DeclKind.Taxonomy`, `"taxonomy"`, `taxonomies:`). (`faithfulness.test.ts` loads legacy-source through `rewrite`, so its on-disk inputs are handled by Step 3; only its inline fixtures/assertions, if any, need editing.)

- [ ] **Step 7: Run the full suite + the model integration tests**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`
Expected: all green — including `src/migrate/tests/model.test.ts` and `faithfulness.test.ts` (legacy-source now rewritten to taxonomy), which still resolve the same records.

- [ ] **Step 8: Commit**

```bash
git add src/migrate/rewriter.ts src/migrate/tests/rewriter.test.ts src/parse/tests/parser.test.ts src/parse/tests/loader.test.ts src/emit/tests/js-module.test.ts src/migrate/tests/faithfulness.test.ts
git commit -m "feat(migrate): rewriter enum->taxonomy; migrate EA enum files + fixtures to taxonomy syntax"
```

(The `test_migration/…/enums/*.todl` edits are outside this git repo; they are saved in place, not committed here.)

---

## Task 6: Remove the enum kind

**Files:**
- Modify: `src/model/kinds.ts` (remove `Enum`)
- Modify: `src/parse/ast.ts` (remove `DeclKind.Enum`, `EnumCase`, `EnumDecl`; drop from `Declaration` union)
- Modify: `src/parse/parser.ts` (remove `parseEnum`, `parseEnumValues`, the `enum` dispatch + keyword-guard entry)
- Modify: `src/model/builder.ts` (remove `EnumCaseInput`, `defineEnum`)
- Modify: `src/parse/loader.ts` (remove the `DeclKind.Enum` cases + the `EnumCaseInput` import)
- Modify: `src/index.ts` (export `TermInput` instead of `EnumCaseInput`)

**Interfaces:**
- Produces: no `enum` surface remains; `TermInput` is the exported term type.

- [ ] **Step 1: Remove `MetaKind.Enum`**

Delete the `Enum = "enum",` line from `src/model/kinds.ts`.

- [ ] **Step 2: Remove enum AST**

In `src/parse/ast.ts`: delete `Enum,` from `DeclKind`; delete the `EnumCase` and `EnumDecl` interfaces; remove `EnumDecl` from the `Declaration` union (leaving `ConceptDecl | TaxonomyDecl | PrimitiveDecl | InstanceDecl`).

- [ ] **Step 3: Remove enum parsing**

In `src/parse/parser.ts`: delete `parseEnum` and `parseEnumValues`; remove the `if (this.checkKeyword("enum")) return this.parseEnum(start);` dispatch line; remove `this.checkKeyword("enum") ||` from the top-level keyword guard (~line 102); remove the now-unused `EnumDecl`/`EnumCase` imports.

- [ ] **Step 4: Remove enum builder**

In `src/model/builder.ts`: delete `EnumCaseInput` and `defineEnum`.

- [ ] **Step 5: Remove enum loader cases**

In `src/parse/loader.ts`: delete the `DeclKind.Enum` cases from all three switches and the `EnumCaseInput` import (keep `TermInput`).

- [ ] **Step 6: Fix the public export**

In `src/index.ts` line 29: `export { Builder, type EnumCaseInput } from "./model/builder.js";` → `export { Builder, type TermInput } from "./model/builder.js";`

- [ ] **Step 7: Typecheck + full suite + grep**

Run: `npx tsc --noEmit` (clean — any lingering enum reference surfaces as a type error), then `npx tsx --conditions=development --test "src/**/*.test.ts"` (all green).
Run: `grep -rn "\bEnum\b\|defineEnum\|EnumCase\|parseEnum\|DeclKind.Enum\|MetaKind.Enum" src --include=*.ts` → expect **no matches** (except possibly the word "enum" inside comments/`enum` TS keyword declarations, which are fine — verify each hit is a TS `enum` keyword, not the removed kind).

- [ ] **Step 8: Commit**

```bash
git add src/model/kinds.ts src/parse/ast.ts src/parse/parser.ts src/model/builder.ts src/parse/loader.ts src/index.ts
git commit -m "refactor: remove the enum kind — taxonomy is the sole classification primitive"
```

---

## Task 7: Conformance gate

**Files:**
- Test: `src/migrate/tests/taxonomy-conformance.test.ts` (create)

**Interfaces:**
- Consumes: `check` from the public API / `../../api.js`; reads `test_migration/test_project` from disk.

- [ ] **Step 1: Write the conformance test**

Create `src/migrate/tests/taxonomy-conformance.test.ts`. It loads the migrated `test_project` from disk and asserts the diagnostic set is unchanged (81 total, all cardinality; 0 on the meta-model) and that taxonomy nodes now carry `typeOf="taxonomy"`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { check } from "../../api.js";
import { MetaKind } from "../../model/kinds.js";

const ROOT = fileURLToPath(new URL("../../../../test_migration/test_project", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (f.endsWith(".todl")) out.push(f);
  }
  return out.sort();
}

function loadProject() {
  const files = walk(ROOT);
  const sources = files.map((f) => ({ uri: relative(ROOT, f).split("\\").join("/"), text: readFileSync(f, "utf8") }));
  return check(sources);
}

test("migrated test_project has the same 81 cardinality diagnostics as before", () => {
  const { diagnostics } = loadProject();
  assert.equal(diagnostics.length, 81);
  const codes = new Set(diagnostics.map((d) => d.code));
  for (const c of codes) assert.match(c, /^cardinality\./, `unexpected code ${c}`);
});

test("classification is now taxonomy-typed and resolves", () => {
  const { model } = loadProject();
  assert.equal(model.resolve("component-category")?.typeOf, MetaKind.Taxonomy);
  assert.equal(model.resolve("component-category.api-service")?.typeOf, "component-category");
  // flag-combos still resolve (a location typed cloud | paas)
  assert.equal(model.resolve("ai-enabled-composable-landscape")?.typeOf, "model");
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/migrate/tests/taxonomy-conformance.test.ts`
Expected: PASS. If the diagnostic count differs from 81, the migration changed behavior — bisect against the pre-migration `check(test_project)` output (the 81 breakdown: `step.kind`×34, `component.in`×10, `connector.source`×8, `connector.type`×7, `sequence.title`×5, `block.components`×4, `scenario.sequences`×3, `sequence.steps`×5, `model.*`×3, `too-many`×2).

- [ ] **Step 3: Full suite + typecheck**

Run: `npx tsc --noEmit` and `npx tsx --conditions=development --test "src/**/*.test.ts"`. All green.

- [ ] **Step 4: Commit**

```bash
git add src/migrate/tests/taxonomy-conformance.test.ts
git commit -m "test: conformance gate — enum->taxonomy migration is behavior-preserving"
```

---

## Completion

After Task 7: `enum` is gone, `taxonomy` is the sole classification primitive, all 17 EA classifications are flat taxonomies, the full suite is green, and the conformance gate proves zero behavior change. Hierarchy authoring (component-category's six roles) and branch-targeting are **SP-Tax2**, a separate plan.
