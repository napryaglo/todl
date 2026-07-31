# Undefined-Reference Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The loader emits a `reference.undefined` Error for every referenced symbol that resolves to neither a local declaration nor a base-model node, and no longer stubs an `UNRESOLVED` placeholder.

**Architecture:** In `loadInto()` (`parse/loader.ts`) collect reference *sites* (`{id, span, node, path}`) instead of a bare id set, diagnose each unresolved site, delete the `UNRESOLVED` stub, and pass the undefined-id set to `Builder.commit()` so it drops (rather than throws on) edges to those ids — keeping `commit()`'s target invariant for genuine bugs. Fixtures that deliberately under-define get their missing symbols defined; the one dedicated undefined test moves to inline sources.

**Tech Stack:** TypeScript (ESM, strict), `tsx --conditions=development --test "src/**/*.test.ts"`.

## Global Constraints

- Work on branch `undefined-reference-detection` (base `main`).
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- New diagnostic value: `ReferenceUndefined = "reference.undefined"`, `Severity.Error`.
- Scope = the currently-tracked reference kinds (taxonomy `represents`, concept `extends`, instance `instanceOf`, instance/term value `Ref`/`Name`). Instance `concept` (typeOf), concept field-types, and relationship-target concepts are **NOT** tracked today and are out of scope (see "Deferred").
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Proven facts (from design investigation)

- Nothing inside TODL reads `unresolved` nodes; only `loader.ts` produced them.
- `Builder.commit()` (`model/builder.ts:172-210`) throws `edge target "…" does not exist` for any staged edge whose target is absent. The stub is what kept those edges valid.
- Edges to referenced targets stage across two commits: `extends`/`represents`/term-relationships on the `first` builder; `instanceOf`/value-refs on the `third` builder.
- AST reference spans already exist: `InstanceDecl.instanceOfSpan`, `ConceptDecl.extendsSpan`, `TaxonomyDecl.representsSpans[]`, and `RefValue.span`; `defined`/`referenced` are collected fully up front (`loader.ts:62-64`), so forward references don't false-positive.
- In the test corpus, `message` and `event-trigger` are referenced but never defined; `sales`/`lane` are defined.

---

### Task 1: `Builder.commit(skip?)` drops edges to known-undefined targets

**Files:**
- Modify: `src/model/builder.ts` (the `commit()` method, ~172-210)
- Test: `src/model/tests/builder.test.ts` (append)

**Interfaces:**
- Produces: `commit(skipMissingTargets?: ReadonlySet<NodeId>): void` — a staged edge whose `to` is in `skipMissingTargets` is silently not applied; any other absent edge target still throws (unchanged). Called with no argument behaves exactly as today.

- [ ] **Step 1: Write the failing test**

Append to `src/model/tests/builder.test.ts`:

```ts
test("commit(skip) drops an edge to a skipped target instead of throwing", () => {
  const model = new Repository();
  const b = model.builder();
  b.assertInstance("thing", "a");            // node "a" exists; "ghost" never will
  b.addInstanceOf("a", "ghost");             // edge a -[InstanceOf]-> ghost (dangling)
  assert.doesNotThrow(() => b.commit(new Set(["ghost"])));
  assert.ok(model.resolve("a") !== undefined, "the source node still commits");
  assert.equal(model.resolve("ghost"), undefined, "the skipped target is not created");
});

test("commit still throws for a missing target that is NOT skipped", () => {
  const model = new Repository();
  const b = model.builder();
  b.assertInstance("thing", "a");
  b.addInstanceOf("a", "ghost");
  assert.throws(() => b.commit(new Set(["other"])), /edge target "ghost" does not exist/);
});
```

(Imports `Repository` — mirror the existing imports at the top of the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/builder.test.ts`
Expected: FAIL — `commit` takes no argument / throws on the skipped target.

- [ ] **Step 3: Implement the skip**

In `src/model/builder.ts`, change the signature and the edge loop:

```ts
  commit(skipMissingTargets?: ReadonlySet<NodeId>): void {
```

Then in the staged-edge validation loop, before the `edge.to` existence check, skip known-undefined targets:

```ts
    for (const edge of this.stagedEdges) {
      if (!exists(edge.from)) {
        throw new Error(`edge source "${edge.from}" does not exist`);
      }
      if (skipMissingTargets?.has(edge.to) && !exists(edge.to)) {
        continue;   // known-undefined (already diagnosed by the loader) — drop the edge
      }
      if (!exists(edge.to)) {
        throw new Error(`edge target "${edge.to}" does not exist`);
      }
    }
```

And in the apply loop, skip the same edges so they are not added:

```ts
    for (const edge of this.stagedEdges) {
      if (skipMissingTargets?.has(edge.to) && !this.graph.hasNode(edge.to)) continue;
      this.graph.addEdge({ kind: edge.kind, via: edge.via, from: edge.from, to: edge.to });
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/builder.test.ts`
Expected: PASS (including the existing "commit is atomic" test at line 40 — an un-skipped missing target still aborts).

- [ ] **Step 5: Commit**

```bash
git add src/model/builder.ts src/model/tests/builder.test.ts
git commit -m "feat(builder): commit(skip) drops edges to known-undefined targets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Loader emits `reference.undefined` and drops the stub

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (add the code)
- Modify: `src/parse/loader.ts` (site collection, diagnose, drop stub, wire commit-skip)
- Test: `src/parse/tests/reference-undefined.test.ts` (create)

**Interfaces:**
- Consumes: `Builder.commit(skip?)` (Task 1); `DiagnosticCode.ReferenceUndefined`.
- Produces: `load(sources)` / `loadInto(model, sources)` return diagnostics containing one `ReferenceUndefined` per unresolved reference site; no `unresolved`-typed nodes are created.

- [ ] **Step 1: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, add to the `DiagnosticCode` enum under the instance-loading group:

```ts
  // Reference-resolution phase.
  ReferenceUndefined = "reference.undefined",
```

- [ ] **Step 2: Write the failing test**

Create `src/parse/tests/reference-undefined.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { DiagnosticCode, Severity } from "../../diagnostics/diagnostic.js";

function src(text: string) { return { uri: "t.todl", text }; }
function undefinedRefs(diags: { code: DiagnosticCode }[]) {
  return diags.filter((d) => d.code === DiagnosticCode.ReferenceUndefined);
}

test("undefined instanceOf target → ReferenceUndefined, node kept, no stub", () => {
  const { model, diagnostics } = load([
    src(`namespace n { concept thing {} thing a { } a instanceOf ghost }`),
  ]);
  const refs = undefinedRefs(diagnostics);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].severity, Severity.Error);
  assert.match(refs[0].message, /ghost/);
  assert.ok(model.resolve("a") !== undefined, "referencing node survives");
  assert.equal(model.resolve("ghost"), undefined, "no UNRESOLVED stub");
});

test("undefined concept extends target → ReferenceUndefined", () => {
  const { diagnostics } = load([src(`namespace n { concept c : missing {} }`)]);
  assert.equal(undefinedRefs(diagnostics).length, 1);
  assert.match(undefinedRefs(diagnostics)[0].message, /missing/);
});

test("undefined value ref → ReferenceUndefined", () => {
  const { model, diagnostics } = load([
    src(`namespace n { concept thing { rel : thing } thing a { rel = &ghost } }`),
  ]);
  assert.equal(undefinedRefs(diagnostics).length, 1);
  assert.equal(model.resolve("ghost"), undefined);
});

test("a reference to a defined symbol produces no diagnostic", () => {
  const { diagnostics } = load([
    src(`namespace n { concept thing {} thing a {} thing b { } b instanceOf a }`),
  ]);
  assert.equal(undefinedRefs(diagnostics).length, 0);
});

test("two references to the same undefined id → two diagnostics", () => {
  const { diagnostics } = load([
    src(`namespace n { concept thing { rel : thing } thing a { rel = &ghost } thing b { rel = &ghost } }`),
  ]);
  assert.equal(undefinedRefs(diagnostics).length, 2);
});
```

> If the exact `.todl` syntax for a concept relationship member or `instanceOf` differs from the above, adjust the source strings to valid syntax (consult `src/parse/tests/fixtures/*.todl` for real examples) — the assertions on diagnostics/nodes stay the same.

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/reference-undefined.test.ts`
Expected: FAIL — no `ReferenceUndefined` diagnostics (ids are stubbed instead).

- [ ] **Step 4: Introduce the `RefSite` type + site collection**

In `src/parse/loader.ts`, add near the top (after imports):

```ts
interface RefSite {
  id: string;
  span: SourceSpan | null;
  node: NodeId | null;
  path: string | null;
}
```

Import `SourceSpan` from `../diagnostics/span.js` and `NodeId` from `../model/graph.js` if not already imported.

Change the three collectors to push `RefSite`s. Replace the `referenced: Set<string>` parameter with `sites: RefSite[]` throughout `collectNames`, `collectInstanceNames`, `collectValueRefs`, sourcing spans from the AST:

- `collectNames` Taxonomy: for each `declaration.represents[i]`, push `{ id: concept, span: declaration.representsSpans?.[i] ?? declaration.span, node: declaration.name, path: null }`. For each term, call `collectValueRefs(assignment.value, sites, \`${declaration.name}.${t.id}\`, assignment.name, assignment.span)`.
- `collectNames` Concept `extends`: push `{ id: declaration.extends, span: declaration.extendsSpan ?? declaration.span, node: declaration.name, path: null }`.
- `collectInstanceNames`: `instanceOf` → `{ id: decl.instanceOf, span: decl.instanceOfSpan ?? decl.span, node: decl.id, path: null }`; each assignment → `collectValueRefs(assignment.value, sites, decl.id, assignment.name, assignment.span)`.
- `collectValueRefs(value, sites, ownerNode, memberName, memberSpan)`: for `ValueKind.Ref` push `{ id: value.ref, span: value.span ?? memberSpan ?? null, node: ownerNode, path: memberName }`; for `ValueKind.Name` push `{ id: value.name, span: memberSpan ?? null, node: ownerNode, path: memberName }`; for `ValueKind.List` recurse each item with the same owner/member.

Update the call site at `loader.ts:62-64`:

```ts
  const defined = new Set<string>();
  const sites: RefSite[] = [];
  for (const declaration of declarations) collectNames(declaration, defined, sites);
```

- [ ] **Step 5: Diagnose + drop the stub + wire commit-skip**

Replace the stub loop (`loader.ts:140-145`) with diagnosis + an undefined-id set:

```ts
  const undefinedIds = new Set<string>();
  for (const site of sites) {
    if (defined.has(site.id) || model.has(site.id)) continue;
    undefinedIds.add(site.id);
    diagnostics.push({
      code: DiagnosticCode.ReferenceUndefined,
      severity: Severity.Error,
      message: `reference to undefined symbol "${site.id}"`,
      span: site.span,
      node: site.node,
      path: site.path,
    });
  }
```

Then pass `undefinedIds` to every `commit()` so edges to those targets are dropped instead of throwing. Change the three commit calls:

```ts
  first.commit(undefinedIds);
  // …
  second.commit(undefinedIds);
  // …
  third.commit(undefinedIds);
```

Remove the now-unused `UNRESOLVED` constant and its `assertInstance` usage.

- [ ] **Step 6: Run the new test to verify it passes**

Run: `npx tsx --conditions=development --test src/parse/tests/reference-undefined.test.ts`
Expected: PASS (all five).

- [ ] **Step 7: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/parse/loader.ts src/parse/tests/reference-undefined.test.ts
git commit -m "feat(loader): emit reference.undefined and drop the UNRESOLVED stub

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Reconcile fixtures + rewrite old stub-behavior tests

**Files:**
- Modify: `src/parse/tests/fixtures/order-fulfillment.todl`, `src/parse/tests/fixtures/concepts.todl` (define the missing symbols)
- Modify: `src/parse/tests/loader.test.ts` (rewrite the undefined test)
- Modify: `src/tests/check-against.test.ts` (rewrite the ghost test)
- Modify: `src/language-service/tests/analysis.test.ts`, `src/language-server/tests/server-bases-multiproject.test.ts` (as the run reveals)
- Modify: `src/parse/loader.ts` (header comment)

**Interfaces:**
- Consumes: `DiagnosticCode.ReferenceUndefined` (Task 2).

- [ ] **Step 1: Rewrite the dedicated undefined test to inline sources**

In `src/parse/tests/loader.test.ts`, replace the `"undefined references become unresolved placeholder nodes"` test (and delete the `UNRESOLVED_TYPEOF` const) with:

```ts
test("an undefined reference is reported, not stubbed", () => {
  const { model, diagnostics } = load([
    { uri: "t.todl", text: `namespace n { concept thing {} thing a { } a instanceOf ghost }` },
  ]);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined && /ghost/.test(d.message)));
  assert.equal(model.resolve("ghost"), undefined);
});
```

Add `import { DiagnosticCode } from "../../diagnostics/diagnostic.js";` to the file if absent.

- [ ] **Step 2: Make the corpus fixtures complete**

Run the corpus tests: `npx tsx --conditions=development --test src/parse/tests/loader.test.ts`. Any failure now comes from a previously-stubbed symbol being dropped. From the design investigation these are `message` (referenced in `order-fulfillment.todl`) and `event-trigger` (referenced in `concepts.todl`).

For each, add a minimal definition to the fixture that owns the reference, matching how it is referenced:
- If referenced via `&name` (a relationship/value target) → define an instance: add `<concept> message { }` under a suitable concept already defined in that fixture.
- If referenced as `extends`/a type/`represents` → define `concept event-trigger { }`.

Inspect the reference site in the fixture (`grep -n "message" order-fulfillment.todl`, `grep -n "event-trigger" concepts.todl`) to choose concept vs instance, then add the definition. Re-run until the corpus tests pass with **zero** `ReferenceUndefined` diagnostics for the corpus.

- [ ] **Step 3: Rewrite the check-against ghost test**

In `src/tests/check-against.test.ts`, replace the assertion at ~line 61 (`model.resolve("nonsense.ghost")?.typeOf === "unresolved"`) with an expectation that, when `nonsense.ghost` is in neither the sources nor the bases, the result carries a `ReferenceUndefined` diagnostic and `model.resolve("nonsense.ghost")` is `undefined`. Keep the rest of the test's base-setup intact; only the final assertions change:

```ts
assert.ok(result.diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined));
assert.equal(model.resolve("nonsense.ghost"), undefined);
```

(Import `DiagnosticCode` if absent. Match the test's existing variable names for `result`/`model`.)

Then add an explicit no-false-positive test alongside it: a source whose reference resolves to a node supplied by the base model must produce **zero** `ReferenceUndefined` diagnostics (reuse the file's existing `checkAgainst`/base-setup helpers):

```ts
test("a reference resolved via the base model is not reported undefined", () => {
  // base defines `payment`; source references it via instanceOf
  const result = /* checkAgainst([baseWithPayment], [src(`… x instanceOf payment …`)]) */;
  assert.equal(result.diagnostics.filter((d) => d.code === DiagnosticCode.ReferenceUndefined).length, 0);
});
```

Fill the `checkAgainst(...)` call using the same base-construction the surrounding tests use (a base model whose graph contains the referenced id).

- [ ] **Step 4: Reconcile the language-service / language-server tests**

Run: `npx tsx --conditions=development --test src/language-service/tests/analysis.test.ts src/language-server/tests/server-bases-multiproject.test.ts`

For each failure caused by a now-dropped stubbed reference: if the test's intent is that the reference resolves via a pushed base, ensure the base actually defines it (the test comment at `analysis.test.ts:33` and `server-bases-multiproject.test.ts:8` describe this). If the intent is genuinely an undefined reference, assert a `ReferenceUndefined` diagnostic instead of a stubbed node. Update the assertions accordingly.

- [ ] **Step 5: Update the loader header comment**

In `src/parse/loader.ts`, update the file-header comment (lines ~5-7) so it no longer claims placeholder nodes are created for undefined references — describe the new behavior (undefined references are reported as `reference.undefined` errors; edges to them are dropped).

- [ ] **Step 6: Commit**

```bash
git add src/parse/tests/fixtures src/parse/tests/loader.test.ts src/tests/check-against.test.ts src/language-service/tests/analysis.test.ts src/language-server/tests/server-bases-multiproject.test.ts src/parse/loader.ts
git commit -m "test(loader): reconcile fixtures + tests with reference.undefined

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Full-suite verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`
Expected: PASS. Investigate any remaining failure — it is almost certainly another test that encoded the old stub behavior (same rewrite pattern as Task 3) or a fixture with a further undefined reference (same completion pattern as Task 3, Step 2).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no unused `UNRESOLVED`/`referenced` symbols left behind).

- [ ] **Step 3: Commit any final reconciliations**

```bash
git add -A
git commit -m "test: full suite green under reference.undefined

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deferred (not in this plan)

`collectNames`/`collectInstanceNames` do **not** track an instance's `concept`
(typeOf), a concept's field *types*, or relationship *target* concepts — so
undefined symbols in those positions are still not reported (they set a dangling
attr rather than a stub or edge). Extending resolution to those positions —
including the `WRAPPER_CONCEPTS` (`technology-library`) and empty-concept
(`concept: ""` composition) edge cases — is a separate design/plan cycle.
