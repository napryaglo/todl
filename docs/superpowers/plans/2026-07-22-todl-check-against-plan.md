# TODL `checkAgainst` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `checkAgainst(bases: TodlDocument[], sources: SourceFile[])` — validate `.todl` sources against already-compiled base models — via a behavior-preserving loader refactor plus base-graph seeding.

**Architecture:** Extract the loader's post-construction body into `loadInto(model, sources)`; make the unresolved-placeholder step skip ids already in the model graph; `checkAgainst` seeds a `Repository` from merged base `TodlDocument`s (first-wins node + edge dedup) then calls `loadInto` + `validate`.

**Tech Stack:** TypeScript (ESM, strict), tests via `tsx --conditions=development --test "src/**/*.test.ts"`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source (per CLAUDE.md).
- Real TypeScript enums; no string-literal union types.
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `checkAgainst([], sources)` MUST equal `check(sources)` (conformance invariant).
- Verify: `npm test` (full suite) and `npm run typecheck`, from the TODL dir.

---

## Task 1: Extract `loadInto`; guard placeholders against base nodes

Behavior-preserving refactor. The existing loader/`load`/`check` suites are the regression gate — they must stay green with no test changes.

**Files:**
- Modify: `src/parse/loader.ts` (the `load` function, lines 44–182)

**Interfaces:**
- Produces: `export function loadInto(model: Repository, sources: SourceFile[]): Diagnostic[]` — parses sources, runs the 3 passes against `model`, defines invariants, records spans, returns diagnostics. `load` becomes a wrapper.

- [ ] **Step 1: Refactor — extract `loadInto`, rewrite `load` as a wrapper**

In `src/parse/loader.ts`, change the `load` function (lines 44–182) so the body after `const model = new Repository();` moves into a new exported `loadInto`. `load` keeps parsing? No — move parsing into `loadInto` too, so it owns the whole pipeline. Result:

```ts
export function load(sources: SourceFile[]): LoadResult {
  const model = new Repository();
  const diagnostics = loadInto(model, sources);
  return { model, diagnostics };
}

// Load `sources` INTO an existing model (which may already carry base nodes from
// a prior compile — see checkAgainst). Same 3-pass pipeline as a fresh load;
// references that resolve to a node already in `model` are not stubbed.
export function loadInto(model: Repository, sources: SourceFile[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const declarations = sources.flatMap((source) => {
    const result = parse(source.text, source.uri);
    diagnostics.push(...result.diagnostics);
    return result.namespace.declarations;
  });

  const defined = new Set<string>();
  const referenced = new Set<string>();
  for (const declaration of declarations) collectNames(declaration, defined, referenced);

  const deferredCompositions: { parentId: string; parentConcept: string; decl: InstanceDecl }[] = [];

  // Pass 1: bare type declarations + placeholders for unresolved references.
  const first = model.builder();
  for (const declaration of declarations) {
    // ... UNCHANGED switch body (Primitive / Taxonomy / Concept / Instance) ...
  }
  for (const id of referenced) {
    // A reference already present in the model (a base node under checkAgainst)
    // resolves to it — don't stub it as UNRESOLVED. Empty graph under plain
    // load(), so this is a no-op there.
    if (!defined.has(id) && !model.has(id)) first.assertInstance(UNRESOLVED, id);
  }
  first.commit();

  // Pass 2a / 2b / invariants / spans — UNCHANGED body ...

  recordSpans(model, declarations);
  return diagnostics;
}
```

Move the entire existing body (the pass-1 switch, pass 2a, pass 2b, invariant definition, `recordSpans`) verbatim into `loadInto`, changing only: (a) it lives in `loadInto(model, sources)` instead of `load`, (b) `return diagnostics;` instead of `return { model, diagnostics };`, (c) the one placeholder line gains `&& !model.has(id)`.

- [ ] **Step 2: Run the full suite to verify no regression**

Run: `npm test`
Expected: PASS — the existing loader / `load` / `check` / json / builder / validate suites are unchanged and still green. The `&& !model.has(id)` guard is inert under `load` (empty graph).

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/parse/loader.ts
git commit -m "refactor(loader): extract loadInto; skip placeholders for nodes already in the model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `checkAgainst` + `mergeBases`

**Files:**
- Modify: `src/api.ts` (add `checkAgainst` + `mergeBases`)
- Modify: `src/index.ts` (export `checkAgainst`)
- Test: `src/tests/check-against.test.ts`

**Interfaces:**
- Consumes: `loadInto` (Task 1); `validate`; `Graph`, `Tier`, `EdgeKind`, `type Node`, `type Edge` (`./model/graph.js`); `Repository`; `type TodlDocument` (`./emit/json.js`); `type SourceFile`; `type Diagnostic`.
- Produces: `export function checkAgainst(bases: TodlDocument[], sources: SourceFile[]): { model: Repository; diagnostics: Diagnostic[] }`.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/check-against.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../api.js";
import { checkAgainst } from "../api.js";
import { toJSON } from "../emit/json.js";
import { Severity } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/span.js";

// A base meta-model: concepts + a base taxonomy the library will reference.
const META: SourceFile = {
  uri: "meta.todl",
  text: `namespace ea {
    concept location  { label : string; }
    concept technology { label : string; applicable-to : component-category; }
    concept category   { label : string; }
    taxonomy component-category : represents category { term platform-api { label = "API"; } }
  }`,
};

// A library-shaped source: a multi-representation taxonomy over base concepts,
// whose technology term references a base taxonomy term.
const LIB: SourceFile = {
  uri: "microsoft.todl",
  text: `namespace lib {
    taxonomy microsoft : represents location, technology {
      location azure { label = "Azure"; }
      technology azure-openai { label = "Azure OpenAI"; applicable-to = component-category.platform-api; }
    }
  }`,
};

const errorCodes = (ds: { severity: Severity; code: string }[]): string[] =>
  ds.filter((d) => d.severity === Severity.Error).map((d) => d.code);

test("checkAgainst([], sources) equals check(sources)", () => {
  const a = check([META]);
  const b = checkAgainst([], [META]);
  assert.deepEqual(errorCodes(b.diagnostics), errorCodes(a.diagnostics));
  assert.deepEqual(b.model.allNodes().map((n) => n.id).sort(), a.model.allNodes().map((n) => n.id).sort());
});

test("a library validates clean against a base meta-model", () => {
  const base = toJSON(check([META]).model);
  const { model, diagnostics } = checkAgainst([base], [LIB]);
  assert.deepEqual(errorCodes(diagnostics), []);
  // The merged model carries both the base concept and the library term.
  assert.ok(model.has("location"));
  assert.equal(model.resolve("microsoft.azure")?.typeOf, "location");
  assert.equal(model.resolve("microsoft.azure-openai")?.typeOf, "technology");
});

test("a reference resolvable in neither base nor source is still flagged", () => {
  const base = toJSON(check([META]).model);
  const bad: SourceFile = {
    uri: "bad.todl",
    text: `namespace lib { taxonomy m : represents location { location x { parent = &nonsense.ghost; } } }`,
  };
  const { model } = checkAgainst([base], [bad]);
  assert.equal(model.resolve("nonsense.ghost")?.typeOf, "unresolved");
});

test("duplicate bases dedup: same base twice matches once", () => {
  const base = toJSON(check([META]).model);
  const once = checkAgainst([base], [LIB]);
  const twice = checkAgainst([base, base], [LIB]);
  assert.deepEqual(errorCodes(twice.diagnostics), errorCodes(once.diagnostics));
  assert.equal(twice.model.allNodes().length, once.model.allNodes().length);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="checkAgainst|library validates|neither base|duplicate bases"` (or just `npm test`)
Expected: FAIL — `checkAgainst` is not exported from `../api.js`.

- [ ] **Step 3: Implement `checkAgainst` + `mergeBases` in `src/api.ts`**

Replace `src/api.ts` with:

```ts
import { load, loadInto } from "./parse/loader.js";
import { validate } from "./validate/validate.js";
import { Graph, Tier, EdgeKind, type Edge } from "./model/graph.js";
import { Repository } from "./model/model.js";
import type { TodlDocument } from "./emit/json.js";
import type { SourceFile } from "./diagnostics/span.js";
import type { Diagnostic } from "./diagnostics/diagnostic.js";

/** Load the sources and validate the result; every diagnostic is spanned. */
export function check(sources: SourceFile[]): { model: Repository; diagnostics: Diagnostic[] } {
  const { model, diagnostics } = load(sources);
  return { model, diagnostics: [...diagnostics, ...validate(model)] };
}

/**
 * Load + validate `sources` against already-compiled base models (published
 * meta-models / libraries, as TodlDocument JSON). Bases seed the graph so a
 * source reference resolves to a base node instead of stubbing UNRESOLVED.
 * `checkAgainst([], sources)` is equivalent to `check(sources)`.
 */
export function checkAgainst(
  bases: TodlDocument[],
  sources: SourceFile[],
): { model: Repository; diagnostics: Diagnostic[] } {
  const model = new Repository(mergeBases(bases));
  const diagnostics = loadInto(model, sources);
  return { model, diagnostics: [...diagnostics, ...validate(model)] };
}

/**
 * Deserialize base documents into one graph with idempotent first-wins dedup:
 * a node id already present is kept (first base wins); an edge identical to one
 * already present (kind + via + from + to) is dropped — so bases sharing a
 * foundation (a library carrying its meta-model) compose without duplicate
 * nodes or double-counted edges. All nodes are added before any edges, since an
 * edge requires both endpoints to exist.
 */
function mergeBases(bases: TodlDocument[]): Graph {
  const graph = new Graph();
  for (const base of bases) {
    for (const node of base.nodes) {
      if (graph.hasNode(node.id)) continue;
      graph.addNode({
        id: node.id,
        tier: Tier[node.tier as keyof typeof Tier],
        typeOf: node.typeOf,
        attrs: new Map(Object.entries(node.attrs)),
      });
    }
  }
  for (const base of bases) {
    for (const edge of base.edges) {
      const kind = EdgeKind[edge.kind as keyof typeof EdgeKind];
      if (hasEdge(graph, kind, edge.via, edge.from, edge.to)) continue;
      graph.addEdge({ kind, via: edge.via, from: edge.from, to: edge.to });
    }
  }
  return graph;
}

/** Is an identical edge (kind + via + from + to) already on the graph? */
function hasEdge(graph: Graph, kind: EdgeKind, via: string | null, from: string, to: string): boolean {
  for (const e of graph.outEdges(from)) {
    if (e.kind === kind && e.via === via && e.to === to) return true;
  }
  return false;
}
```

Note: `Edge` import is only needed if referenced; the `hasEdge` loop uses the inferred element type of `outEdges`, so drop the `type Edge` import if tsc flags it as unused.

- [ ] **Step 4: Export `checkAgainst` from `src/index.ts`**

Change the api export line:

```ts
export { check, checkAgainst } from "./api.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all four new tests plus the full existing suite.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. If `type Edge` is unused, remove it from the import.

- [ ] **Step 7: Commit**

```bash
git add src/api.ts src/index.ts src/tests/check-against.test.ts
git commit -m "feat(api): add checkAgainst(bases, sources) — validate against compiled base models

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Definition of Done

- `npm test` and `npm run typecheck` pass.
- `checkAgainst` is exported from the package entry.
- `checkAgainst([], src)` matches `check(src)` (conformance).
- A library-shaped source validates clean against a base meta-model; a genuinely
  unresolved reference still flags; duplicate bases dedup.
