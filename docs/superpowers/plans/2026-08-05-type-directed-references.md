# Type-Directed References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TODL loader decide attribute-vs-reference-edge from a member's *declared type* (not the value's surface syntax), unify that rule across instances and taxonomy terms, and retire the `&` reference sigil.

**Architecture:** A single shared helper classifies each member as *reference-like* (its declared type resolves to a `concept` or `taxonomy`) or *value-like* (everything else) and realizes the value as an edge or an attr accordingly. Instances already have their concept schema committed when values are applied, so they switch over directly; taxonomy terms are built before schemas exist, so their non-literal assignments are **deferred** to a new pass that runs after concept members commit and reuses the same helper. The grammar drops `&` last, once nothing depends on the `Ref` value kind.

**Tech Stack:** TypeScript (ESM, strict), `node:test` + `node:assert/strict`. Run a single test file with `npx tsx --conditions=development --test src/<path>/tests/<file>.test.ts` from the `TODL/` directory.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises (e.g. `src/parse/tests/…`), never beside the source.
- Real enums, never string-literal unions. Reuse `MetaKind` (`src/model/kinds.ts`) and `ValueKind`/`DeclKind` (`src/parse/ast.ts`); add new diagnostic codes to the existing `DiagnosticCode` enum.
- The reference-like rule is exactly: a member is reference-like iff it is a `->` relationship member, OR it is a `:` field member whose declared `type` resolves to a node with `typeOf === MetaKind.Concept` or `typeOf === MetaKind.Taxonomy`. Primitive-typed fields and unresolved types are value-like.
- Do not change `->` relationship declaration semantics or the `HasField`/`HasRelationship` schema buckets. This change is about *instance/term value realization*, not concept declarations.
- Composition ownership/cascade, inverse-multiplicity exclusivity, and any `owned`/`shared` modifier are OUT OF SCOPE.
- Commit after each task. Do not push. Do not touch Plexus/Mural in this plan (separate follow-up).

---

## File Structure

- `src/parse/loader.ts` — the core change: new classification + realization helpers, rewired instance pass, new deferred-term pass. Largest edit.
- `src/parse/parser.ts` — remove `&` from `parseValue` and `parseRef`; relationship/connector endpoints parse bare names.
- `src/parse/ast.ts` — remove `ValueKind.Ref` / `RefValue`.
- `src/parse/lexer.ts` — remove the now-unused `Amp` token (only if nothing else references it).
- `src/validate/validate.ts` — one new `DiagnosticCode` for a member value-kind mismatch.
- `src/migrate/rewriter.ts` — stop producing `&`; strip legacy `@`/`&` reference sigils to bare names.
- Tests colocated in each area's `tests/` subfolder.

---

### Task 1: Member-type classification helper

**Files:**
- Modify: `src/parse/loader.ts` (add two module-private helpers near the other value helpers, ~line 479)
- Test: `src/parse/tests/classify-member.test.ts` (create)

**Interfaces:**
- Consumes: `Repository.resolve(id)`, `Repository.effectiveSchema(concept)` (returns `{ fields: {name,type,cardinality}[], relationships: {name,target,cardinality,inverse}[] }`), `MetaKind` from `../model/kinds.js`.
- Produces:
  - `isReferenceType(model: Repository, type: string | undefined): boolean`
  - `isReferenceMember(model: Repository, concept: string, name: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/parse/tests/classify-member.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { __test__ } from "../loader.js";

function model(text: string) {
  return loadFiles([{ uri: "s.todl", text }]).model;
}

const SRC = `namespace d {
  concept technology { label : string; }
  concept component { label : string; implemented-by : technology?; }
  taxonomy category represents component { alpha; }
}`;

test("field typed by a concept is reference-like", () => {
  const m = model(SRC);
  assert.equal(__test__.isReferenceMember(m, "component", "implemented-by"), true);
});

test("field typed by a primitive is value-like", () => {
  const m = model(SRC);
  assert.equal(__test__.isReferenceMember(m, "component", "label"), false);
});

test("a type resolving to a taxonomy is reference-like", () => {
  const m = model(SRC);
  assert.equal(__test__.isReferenceType(m, "category"), true);
  assert.equal(__test__.isReferenceType(m, "string"), false);
  assert.equal(__test__.isReferenceType(m, "does-not-exist"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/classify-member.test.ts`
Expected: FAIL — `__test__` / `isReferenceMember` not exported.

- [ ] **Step 3: Add the helpers and a test-only export**

In `src/parse/loader.ts`, add the `MetaKind` import at the top with the other model imports:

```ts
import { MetaKind } from "../model/kinds.js";
```

Add near the other value helpers (around line 479, before `termAttrs`):

```ts
/** A type is reference-like when it resolves to a concept or taxonomy node;
 * primitives and unresolved ids are value-like. */
function isReferenceType(model: Repository, type: string | undefined): boolean {
  if (type === undefined) return false;
  const kind = model.resolve(type)?.typeOf;
  return kind === MetaKind.Concept || kind === MetaKind.Taxonomy;
}

/** A member is reference-like when it is a `->` relationship, or a `:` field
 * whose declared type is reference-like. Reads the effective (inherited) schema
 * of `concept`, so schemas must be committed before this is called. */
function isReferenceMember(model: Repository, concept: string, name: string): boolean {
  const schema = model.effectiveSchema(concept);
  if (schema.relationships.some((r) => r.name === name)) return true;
  const field = schema.fields.find((f) => f.name === name);
  return field !== undefined && isReferenceType(model, field.type);
}
```

At the bottom of `src/parse/loader.ts`, export a test hook (append):

```ts
export const __test__ = { isReferenceType, isReferenceMember };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test src/parse/tests/classify-member.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parse/loader.ts src/parse/tests/classify-member.test.ts
git commit -m "feat(loader): type-directed member classification helper"
```

---

### Task 2: Type-directed value realization for instances

**Files:**
- Modify: `src/parse/loader.ts` — replace `applyValue` (line 720-743) with a shared `realizeValue`; update its caller in `applyInstance` (line 679-681).
- Modify: `src/validate/validate.ts` — add one `DiagnosticCode` member.
- Test: `src/parse/tests/type-directed-instances.test.ts` (create)

**Interfaces:**
- Consumes: `isReferenceMember` (Task 1), `Builder.setField(id, name, scalar)`, `Builder.addRelationship(from, name, to)`, `ValueKind`, `Repository.effectiveRelationships(leaf)` (returns `Map<string, NodeId[]>`), `Repository.effectiveFields(leaf)` (returns `Map<string, Scalar>`).
- Produces: `realizeValue(builder: Builder, model: Repository, concept: string, id: string, name: string, value: ValueNode, diagnostics: Diagnostic[]): void` — replaces `applyValue`.
- Produces (validate.ts): `DiagnosticCode.MemberValueKind` (new enum member).

- [ ] **Step 1: Write the failing test**

```ts
// src/parse/tests/type-directed-instances.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { DiagnosticCode } from "../../validate/validate.js";

function loaded(text: string) {
  return loadFiles([{ uri: "s.todl", text }]);
}

const BASE = `namespace d {
  concept technology { label : string; }
  concept component { label : string; category : string; implemented-by : technology?; }
  model microsoft : ea {
    technology m365-copilot { label = "Copilot"; }
    component a { label = "A"; implemented-by = m365-copilot; }
    component b { label = "B"; implemented-by = m365-copilot; }
  }
  concept ea { }
}`;

test("concept-typed field becomes a shared reference edge, not an attr", () => {
  const m = loaded(BASE).model;
  // Both components edge to the same technology node.
  assert.deepEqual(m.related("a", EdgeKind.Relationship, Direction.Out, "implemented-by"), ["m365-copilot"]);
  assert.deepEqual(m.related("b", EdgeKind.Relationship, Direction.Out, "implemented-by"), ["m365-copilot"]);
  // Reverse: the technology is shared by both owners.
  assert.deepEqual(
    m.related("m365-copilot", EdgeKind.Relationship, Direction.In, "implemented-by").sort(),
    ["a", "b"],
  );
  // It is NOT a scalar attr.
  assert.equal(m.resolve("a")?.attrs.has("implemented-by"), false);
});

test("primitive-typed field stays a scalar attr", () => {
  const m = loaded(BASE).model;
  assert.equal(m.resolve("a")?.attrs.get("label"), "A");
});

test("a concept-typed field given a quoted string is a value-kind error", () => {
  const bad = `namespace d {
    concept technology { label : string; }
    concept component { implemented-by : technology?; }
    model microsoft : ea { component a { implemented-by = "m365-copilot"; } }
    concept ea { }
  }`;
  const codes = loaded(bad).diagnostics.map((d) => d.code);
  assert.ok(codes.includes(DiagnosticCode.MemberValueKind));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/type-directed-instances.test.ts`
Expected: FAIL — `implemented-by` still lands per the old blunt rule and `DiagnosticCode.MemberValueKind` does not exist.

- [ ] **Step 3: Add the diagnostic code**

In `src/validate/validate.ts`, add to the `DiagnosticCode` enum (keep the existing string-value convention used by the other members):

```ts
  MemberValueKind = "member.value-kind",
```

- [ ] **Step 4: Replace `applyValue` with `realizeValue`**

In `src/parse/loader.ts`, delete `applyValue` (line 720-743) and add:

```ts
/** Realize one authored assignment onto `id`, choosing attr vs edge from the
 * member's declared type (not the value's syntax). Shared by the instance pass
 * and the deferred-term pass. */
function realizeValue(
  builder: Builder,
  model: Repository,
  concept: string,
  id: string,
  name: string,
  value: ValueNode,
  diagnostics: Diagnostic[],
): void {
  const reference = isReferenceMember(model, concept, name);
  const mismatch = (msg: string): void => {
    diagnostics.push({
      code: DiagnosticCode.MemberValueKind,
      severity: Severity.Error,
      message: msg,
      span: undefined,
      node: id,
      path: `${concept}.${name}`,
    });
  };

  switch (value.kind) {
    case ValueKind.String:
      if (reference) return mismatch(`"${concept}.${name}" is a reference — expected a name, not a quoted string`);
      builder.setField(id, name, value.text);
      break;
    case ValueKind.Boolean:
      if (reference) return mismatch(`"${concept}.${name}" is a reference — expected a name, not a boolean`);
      builder.setField(id, name, value.value);
      break;
    case ValueKind.Name:
      if (reference) builder.addRelationship(id, name, value.name);
      else builder.setField(id, name, value.name);
      break;
    case ValueKind.Ref: // legacy `&ref`; removed from the grammar in a later task
      builder.addRelationship(id, name, value.ref);
      break;
    case ValueKind.List:
      for (const item of value.items) realizeValue(builder, model, concept, id, name, item, diagnostics);
      break;
    case ValueKind.Composite:
      if (reference) {
        // A `|`-composed selection of taxonomy terms → one edge per part.
        for (const part of value.parts) builder.addRelationship(id, name, part);
      } else {
        // Enum-flag scalar kept as the legacy `|`-joined string.
        builder.setField(id, name, value.parts.join(" | "));
      }
      break;
  }
}
```

Update the caller in `applyInstance` (was line 679-681):

```ts
  for (const assignment of decl.assignments) {
    realizeValue(builder, model, decl.concept, decl.id, assignment.name, assignment.value, diagnostics);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test src/parse/tests/type-directed-instances.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Run the loader suite to catch regressions**

Run: `npx tsx --conditions=development --test src/parse/tests/loader.test.ts`
Expected: PASS. If a corpus fixture instance sets a concept-typed field via a bare name and the referent is undefined, that surfaces as `reference.undefined` — fix the fixture's referent, do not weaken the rule.

- [ ] **Step 7: Commit**

```bash
git add src/parse/loader.ts src/validate/validate.ts src/parse/tests/type-directed-instances.test.ts
git commit -m "feat(loader): type-directed value realization for instances"
```

---

### Task 3: Deferred, type-directed value realization for taxonomy terms

**Files:**
- Modify: `src/parse/loader.ts` — stop classifying term values by `ValueKind` in Pass 1; collect non-literal term assignments into a deferred list and realize them after concept members commit (after Pass 2a, alongside the existing `deferredCompositions` handling).
- Test: `src/parse/tests/type-directed-terms.test.ts` (create)

**Interfaces:**
- Consumes: `realizeValue` (Task 2), the existing `termAttrs` (line 481) for literal scalars, the builder returned by `model.builder()`, the `TermInput.attrs`/`.relationships` shape consumed by `builder.defineTaxonomy`.
- Produces: a module-private `deferredTermValues: { concept: string; termId: string; name: string; value: ValueNode }[]` populated in Pass 1 and drained after Pass 2a.

- [ ] **Step 1: Write the failing test**

```ts
// src/parse/tests/type-directed-terms.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { EdgeKind, Direction } from "../../model/graph.js";

function model(text: string) {
  return loadFiles([{ uri: "s.todl", text }]).model;
}

const SRC = `namespace d {
  concept technology { label : string; }
  concept component { label : string; implemented-by : technology?; }
  model shared : ea { technology m365-copilot { label = "Copilot"; } }
  concept ea { }
  taxonomy kinds represents component {
    chat { label = "Chat"; implemented-by = m365-copilot; }
  }
}`;

test("a term's concept-typed field is realized as an edge, not a string attr", () => {
  const m = model(SRC);
  assert.deepEqual(
    m.related("kinds.chat", EdgeKind.Relationship, Direction.Out, "implemented-by"),
    ["m365-copilot"],
  );
  assert.equal(m.resolve("kinds.chat")?.attrs.has("implemented-by"), false);
});

test("a term's primitive-typed field stays a scalar attr", () => {
  const m = model(SRC);
  assert.equal(m.resolve("kinds.chat")?.attrs.get("label"), "Chat");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/type-directed-terms.test.ts`
Expected: FAIL — under the old term path a bare `implemented-by = m365-copilot` becomes a string attr, so the edge assertion fails.

- [ ] **Step 3: Collect non-literal term assignments as deferred, keep only literals as attrs**

In `src/parse/loader.ts`, replace `termRelationships` usage. The term-building site (Pass 1, ~line 304-306) currently builds each `TermInput` with `attrs: termAttrs(t.assignments)` and `relationships: termRelationships(t.assignments)`. Change it to keep only literal attrs and defer everything reference-shaped.

Near the top of the pass loop, add the deferral accumulator beside `deferredCompositions` (line 246):

```ts
  const deferredTermValues: { concept: string; termId: string; name: string; value: ValueNode }[] = [];
```

In `buildTerm`, stop emitting `relationships`, and record deferred values instead. Where the `TermInput` is constructed (the object with `attrs`/`relationships`), change to:

```ts
          for (const assignment of t.assignments) {
            const v = assignment.value;
            const literal = v.kind === ValueKind.String || v.kind === ValueKind.Boolean;
            if (!literal) {
              deferredTermValues.push({ concept: ownConcept, termId: `${decl.name}.${t.id}`, name: assignment.name, value: v });
            }
          }
```

and build the `TermInput` with `attrs: termLiteralAttrs(t.assignments)` and no `relationships` key (pass `relationships: []`). Add a literal-only attr helper next to `termAttrs`:

```ts
/** A term's literal scalar attrs only (String/Boolean). Name/Ref/List/Composite
 * are deferred and classified by type after schemas commit. */
function termLiteralAttrs(assignments: AssignmentNode[]): Map<string, Scalar> {
  const attrs = new Map<string, Scalar>();
  for (const assignment of assignments) {
    const value = assignment.value;
    if (value.kind === ValueKind.String) attrs.set(assignment.name, value.text);
    else if (value.kind === ValueKind.Boolean) attrs.set(assignment.name, value.value);
  }
  return attrs;
}
```

(Leave `termAttrs`/`termRelationships` in place only if other call sites use them; otherwise delete them in this task and confirm no references remain.)

- [ ] **Step 4: Drain the deferred term values after concept members commit**

Find where `deferredCompositions` is applied (after Pass 2a, the `applyInstance(... composition.decl ...)` loop near line 381). Immediately after that loop, drain the term values through the shared helper on a fresh builder, then commit:

```ts
  const termBuilder = model.builder();
  for (const d of deferredTermValues) {
    realizeValue(termBuilder, model, d.concept, d.termId, d.name, d.value, diagnostics);
  }
  termBuilder.commit();
```

(If the surrounding code already holds an open builder at that point, reuse it and keep a single `commit()`; do not double-commit. Match the existing pattern in that block.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test src/parse/tests/type-directed-terms.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Run the taxonomy/loader suites for regressions**

Run: `npx tsx --conditions=development --test src/parse/tests/loader.test.ts src/parse/tests/taxonomy-load.test.ts src/validate/tests/taxonomy-validate.test.ts`
Expected: PASS. Terms that referenced siblings via bare names now become edges — if a previously-string term value no longer round-trips as an attr, update the assertion to check the edge (that is the intended behavior change), not the code.

- [ ] **Step 7: Commit**

```bash
git add src/parse/loader.ts src/parse/tests/type-directed-terms.test.ts
git commit -m "feat(loader): deferred type-directed realization for taxonomy terms"
```

---

### Task 4: Retire the `&` sigil from the grammar

**Files:**
- Modify: `src/parse/ast.ts` — remove `ValueKind.Ref` and `RefValue` from the union (line 25, 48-54, 70).
- Modify: `src/parse/parser.ts` — `parseValue` no longer special-cases `TokenKind.Amp` (line 422-431); `parseRef` (line 404-406) parses a bare dotted path.
- Modify: `src/parse/loader.ts` — delete the now-dead `case ValueKind.Ref` branch in `realizeValue`.
- Modify: `src/parse/lexer.ts` — remove the `Amp` token only if no production references it after the above.
- Test: `src/parse/tests/no-sigil.test.ts` (create); update any existing parser/loader tests that author `&`.

**Interfaces:**
- Consumes: nothing new.
- Produces: grammar where references and relationship/connector endpoints are bare names.

- [ ] **Step 1: Write the failing test**

```ts
// src/parse/tests/no-sigil.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { EdgeKind, Direction } from "../../model/graph.js";

function loaded(text: string) { return loadFiles([{ uri: "s.todl", text }]); }

const SRC = `namespace d {
  concept technology { label : string; }
  concept component { implemented-by : technology?; }
  model m : ea {
    technology t { label = "T"; }
    component c { implemented-by = t; }
  }
  concept ea { }
}`;

test("a bare name resolves as a reference with no sigil, and no parse error", () => {
  const r = loaded(SRC);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === "error"), []);
  assert.deepEqual(loaded(SRC).model.related("c", EdgeKind.Relationship, Direction.Out, "implemented-by"), ["t"]);
});

test("a leftover `&` sigil is now a parse error", () => {
  const r = loaded(SRC.replace("implemented-by = t;", "implemented-by = &t;"));
  assert.ok(r.diagnostics.some((d) => d.severity === "error"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/no-sigil.test.ts`
Expected: FAIL — the second test fails because `&t` currently parses fine.

- [ ] **Step 3: Remove `Ref` from the AST**

In `src/parse/ast.ts`: delete the `Ref` member from `ValueKind` (line 25), delete the `RefValue` interface (line 48-54), and remove `| RefValue` from the `ValueNode` union (line 70).

- [ ] **Step 4: Update the parser**

In `src/parse/parser.ts`, delete the `if (this.check(TokenKind.Amp)) { … }` block in `parseValue` (line 422-431). Change `parseRef` (line 404-406) to:

```ts
  private parseRef(): string {
    return this.parseDottedPath();
  }
```

Update the connector/edge-record parser (line 359-406) so endpoints no longer `expect(TokenKind.Amp)`. Materialize endpoints as `ValueKind.Name` instead of `ValueKind.Ref` (line 370-371):

```ts
      { name: fromField, value: { kind: ValueKind.Name, name: from } },
      { name: toField, value: { kind: ValueKind.Name, name: to } },
```

- [ ] **Step 5: Delete the dead loader branch**

In `src/parse/loader.ts`, remove the `case ValueKind.Ref:` branch from `realizeValue` (added in Task 2). A reference is now always a `Name`.

- [ ] **Step 6: Remove the `Amp` token if unused**

Search: `git grep -n "TokenKind.Amp" src/`. If no references remain, remove `Amp` from `TokenKind` and its scan rule in `src/parse/lexer.ts`. If references remain, leave the token and note them.

- [ ] **Step 7: Fix existing tests that author `&`**

Search: `git grep -ln "= &" src/ ; git grep -ln '&[a-z]' src/parse/tests src/validate/tests`. In each hit that is a `.todl` source string or fixture, drop the `&`. Re-run each edited file.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test src/parse/tests/no-sigil.test.ts src/parse/tests/loader.test.ts src/parse/tests/parser.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/loader.ts src/parse/lexer.ts src/parse/tests/
git commit -m "feat(parse): retire the & reference sigil (type-directed references)"
```

---

### Task 5: Lock in `effectiveFields`/`effectiveRelationships` split and the orphan-is-error rule

**Files:**
- Test: `src/model/tests/effective-references.test.ts` (create)
- Test: `src/parse/tests/instance-orphan.test.ts` (create)
- Modify (only if a test reveals a gap): `src/model/model.ts`.

**Interfaces:**
- Consumes: `Repository.effectiveFields(leaf)`, `Repository.effectiveRelationships(leaf)`, `DiagnosticCode.InstanceOrphan` (already `Severity.Error` at loader.ts:555-562).
- Produces: regression tests locking the read-shape and the orphan rule. No new production API expected.

- [ ] **Step 1: Write the failing/locking tests**

```ts
// src/model/tests/effective-references.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../../parse/loader.js";

function model(text: string) { return loadFiles([{ uri: "s.todl", text }]).model; }

const SRC = `namespace d {
  concept technology { label : string; }
  concept component { label : string; implemented-by : technology?; }
  model m : ea {
    technology t { label = "T"; }
    component c { label = "C"; implemented-by = t; }
  }
  concept ea { }
}`;

test("effectiveFields holds primitives only; concept fields live in effectiveRelationships", () => {
  const m = model(SRC);
  assert.equal(m.effectiveFields("c").get("label"), "C");
  assert.equal(m.effectiveFields("c").has("implemented-by"), false);
  assert.deepEqual(m.effectiveRelationships("c").get("implemented-by"), ["t"]);
});
```

```ts
// src/parse/tests/instance-orphan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { DiagnosticCode } from "../../validate/validate.js";

function diags(text: string) { return loadFiles([{ uri: "s.todl", text }]).diagnostics; }

test("a concrete object outside a model is an error", () => {
  const src = `namespace d { concept component { label : string; } component c { label = "C"; } }`;
  const ds = diags(src);
  assert.ok(ds.some((d) => d.code === DiagnosticCode.InstanceOrphan && d.severity === "error"));
});

test("the same object inside a model is clean", () => {
  const src = `namespace d { concept component { label : string; } concept ea { } model m : ea { component c { label = "C"; } } }`;
  assert.ok(!diags(src).some((d) => d.code === DiagnosticCode.InstanceOrphan));
});
```

- [ ] **Step 2: Run tests**

Run: `npx tsx --conditions=development --test src/model/tests/effective-references.test.ts src/parse/tests/instance-orphan.test.ts`
Expected: PASS (both files rely on Tasks 2 & 4 and the existing orphan rule). If `effective-references` fails, the fix is in `Repository.effectiveFields`/`effectiveRelationships` in `src/model/model.ts` — but per the design these already behave correctly, so a failure means an earlier task regressed; fix there, not here.

- [ ] **Step 3: Commit**

```bash
git add src/model/tests/effective-references.test.ts src/parse/tests/instance-orphan.test.ts
git commit -m "test: lock effective-fields split and instance-orphan-is-error"
```

---

### Task 6: Migration — strip `&` to bare names in the rewriter

**Files:**
- Modify: `src/migrate/rewriter.ts` — `rewriteReferences` (line 32-35) currently maps `@` → `&`; change it to strip both legacy `@` and current `&` reference sigils to bare names.
- Test: `src/migrate/tests/rewriter.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `rewrite(legacySource)` output that contains no `&`/`@` reference sigils.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/migrate/tests/rewriter.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { rewrite } from "../rewriter.js";

test("strips legacy @ and current & reference sigils to bare names", () => {
  assert.equal(rewrite("implemented-by = @m365;"), "implemented-by = m365;");
  assert.equal(rewrite("implemented-by = &m365;"), "implemented-by = m365;");
  assert.equal(rewrite("realised-by = [ @a, &b ];"), "realised-by = [ a, b ];");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/migrate/tests/rewriter.test.ts`
Expected: FAIL — `@` currently becomes `&`, not bare.

- [ ] **Step 3: Update `rewriteReferences`**

In `src/migrate/rewriter.ts`, replace `rewriteReferences` (line 32-35):

```ts
/** `@m365` / `&m365` → `m365`. Strip the reference sigil before a lowercase
 * identifier start; the type-directed loader resolves bare names as references. */
function rewriteReferences(source: string): string {
  return source.replace(/[@&](?=[a-z])/g, "");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test src/migrate/tests/rewriter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/migrate/rewriter.ts src/migrate/tests/rewriter.test.ts
git commit -m "feat(migrate): strip reference sigils to bare names"
```

---

### Task 7: Full suite, docs, and version bump

**Files:**
- Modify: `package.json` — bump the `@pragmatic-tech-ai/todl` version (breaking; minor bump per the project's 0.x convention, matching how namespace-scoped/taxonomy-bare shipped).
- Modify: `CLAUDE.md` and/or the language manual under `src/stdlib` or `docs/` if they document the `&` sigil — remove it and state the type-directed rule.
- Test: whole suite.

**Interfaces:**
- Consumes: everything above.
- Produces: a green suite and a published-ready version.

- [ ] **Step 1: Run the whole test suite**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`
Expected: PASS. Investigate every failure; a fixture asserting an old string-attr where the design now dictates an edge is updated to assert the edge — do not weaken the rule to make a stale assertion pass.

- [ ] **Step 2: Grep the docs for the sigil and the old rule**

Run: `git grep -n "&ref\|& sigil\|reference sigil\|ValueKind.Ref" -- docs src *.md`
Expected: only historical/spec references remain. Update user-facing docs (language manual, `CLAUDE.md` if it describes value syntax) to describe the type-directed rule and the absence of `&`.

- [ ] **Step 3: Bump the version**

Edit `package.json`: raise the `version` field one minor (e.g. `0.10.0` → `0.11.0`; confirm the current value first with `node -p "require('./package.json').version"`).

- [ ] **Step 4: Re-run the suite after edits**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json CLAUDE.md docs src
git commit -m "chore(todl): type-directed references — docs + version bump"
```

---

## Downstream (separate follow-up plan, NOT in this plan)

Publishing this TODL version and updating consumers is its own subsystem and gets its own plan:

- Republish `@pragmatic-tech-ai/todl` to Verdaccio; bump Plexus/Mural to the new floor.
- Audit Plexus/Mural for any read of a concept-typed field via `effectiveFields` (or the emitted `toJSON` attrs) and move it to `effectiveRelationships`/edges.
- Re-run the corpus migration (`rewriter`) over `microsoft.todl` and the library sources; fix the `reference.undefined` diagnostics that surface where a bare name never had a declared referent (genuine authoring gaps).
- Update the `toMetaModule` JS-module emitter if it materializes concept-typed fields as scalar properties.

---

## Self-Review

**Spec coverage:**
- Type-directed rule (primitive→attr, concept→edge, taxonomy→edge) → Tasks 1-3.
- `:` vs `->` both edges, composition deferred → enforced by not touching declaration buckets (Global Constraints) + Tasks 2-3 realization.
- Grammar: remove `&` from field values AND relationship/connector endpoints → Task 4.
- Loader deferral wrinkle for terms → Task 3.
- `effectiveFields`/`effectiveRelationships` split → Task 5.
- Validation: type/value mismatch + orphan-is-error → Tasks 2 & 5.
- Migration + version bump → Tasks 6 & 7; downstream consumer audit → explicitly deferred to a follow-up plan.

**Placeholder scan:** No TBD/TODO; every code step carries concrete code. Line numbers are anchors for the implementer to locate current code, not literal edit targets.

**Type consistency:** `realizeValue(builder, model, concept, id, name, value, diagnostics)` — same signature in Tasks 2, 3, 4. `isReferenceMember(model, concept, name)` / `isReferenceType(model, type)` — same across Tasks 1-3. `DiagnosticCode.MemberValueKind` / `DiagnosticCode.InstanceOrphan` used consistently. `EdgeKind.Relationship` + `via = name` matches `Builder.addRelationship` and `Repository.effectiveRelationships`.

**Note for the implementer:** the design spec groups "taxonomy / enum" together, but current TODL has no live `enum` decl kind — legacy enums are rewritten to taxonomies (`rewriter.ts` `rewriteEnumToTaxonomy`), and `|`-composed flag values are `ValueKind.Composite`. The precise runtime rule is therefore: reference-like = type resolves to `MetaKind.Concept` or `MetaKind.Taxonomy`; a `Composite` value on a value-like member stays a `|`-joined string attr (Task 2, Step 4).
