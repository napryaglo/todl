# Edge-record Cleanup (SP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `parseEdgeRecord` injecting a dead `operator` attr and minting `#`/`-` (lexer-invalid) synthetic ids, and strip the 42 dead `operator = "…"` lines from `landscape.todl`.

**Architecture:** Two edits to `src/parse/parser.ts` (drop the operator assignment; change synthetic ids to underscore form), a committed `scripts/strip-edge-operator.ts` for the on-disk data cleanup, and parser tests. No emitter change (the instance emit round-trip is already covered by the unchanged `src/emit/tests/todl.test.ts`).

**Tech Stack:** TypeScript (ESM, strict), TODL compiler `@pragmatic-lab/todl`. Runner: `tsx --conditions=development --test`.

## Global Constraints

- Data dir `plexus_tests/architecures/test_architecture/` is **not a git repository**: its `.todl` edits are on-disk (produced by the committed strip script), not version-controlled. Only TODL-repo artifacts (parser change, strip script, tests, spec, plan) are committed on branch `feat/sp4-edge-record-cleanup`.
- Synthetic id form: `` `${concept}_${n}` `` for edge records; `` `application_connectors_${n}` `` for the connectors container. `#` and `-` are invalid C-like identifier characters.
- `consumeEdgeOperator()` is unchanged — both `->` and `-->` still parse; the glyph is discarded.
- Project must stay at **0** data-file diagnostics (SP3 gate `scripts/check-project.ts`).
- Every TODL test file lives in a `tests/` subfolder next to its source.
- Real TypeScript `enum`s. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No `npm publish`, no git push, no TODL version bump.
- Data-gate command (bash, from TODL repo root):
  ```bash
  P="C:/Users/Eugene/Projects/plexus_tests"
  npx tsx --conditions=development scripts/check-project.ts "$P/meta-models/tech-architecture" "$P/architecures/test_architecture" "$P/libraries/microsoft/microsoft.todl" "$P/libraries/aws/aws.todl"
  ```

---

### Task 1: Parser cleanup — drop `operator`, lexer-valid ids

**Files:**
- Modify: `src/parse/parser.ts` (`parseEdgeRecord` ~385–409, `parseApplicationConnectors` ~412–424)
- Test: `src/parse/tests/edge-record.test.ts`

**Interfaces:**
- Consumes: `parse(source, uri?)` from `src/parse/parser.js` → `{ namespace, diagnostics }`; `DeclKind`, `ValueKind`, `type NameValue` from `src/parse/ast.js`.
- Produces: edge-record instances with only `from`/`to` (or `src`/`dst`) + explicit body fields (no `operator`), and ids matching `/^<concept>_\d+$/`.

- [ ] **Step 1: Write the failing tests**

Create `src/parse/tests/edge-record.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, ValueKind, type NameValue } from "../ast.js";

test("a native connector edge record has from/to, no operator attr, and a lexer-valid id", () => {
  const { namespace } = parse(`namespace d { connector businessAgent --> agentOrchestrator; }`);
  const edge = namespace.declarations[0]!;
  assert.ok(edge.kind === DeclKind.Instance);
  if (edge.kind === DeclKind.Instance) {
    assert.equal((edge.assignments.find((a) => a.name === "from")?.value as NameValue).name, "businessAgent");
    assert.equal((edge.assignments.find((a) => a.name === "to")?.value as NameValue).name, "agentOrchestrator");
    assert.equal(edge.assignments.find((a) => a.name === "operator"), undefined);
    assert.match(edge.id, /^connector_\d+$/);
  }
});

test("a native step edge record binds src/dst with no operator attr", () => {
  const { namespace } = parse(`namespace d { step a -> b; }`);
  const edge = namespace.declarations[0]!;
  assert.ok(edge.kind === DeclKind.Instance);
  if (edge.kind === DeclKind.Instance) {
    assert.equal((edge.assignments.find((a) => a.name === "src")?.value as NameValue).name, "a");
    assert.equal((edge.assignments.find((a) => a.name === "dst")?.value as NameValue).name, "b");
    assert.equal(edge.assignments.find((a) => a.name === "operator"), undefined);
    assert.match(edge.id, /^step_\d+$/);
  }
});

test("the synthetic id re-parses as an instance header; the old #-form does not", () => {
  const { namespace } = parse(`namespace d { connector a --> b; }`);
  const edge = namespace.declarations[0]!;
  assert.ok(edge.kind === DeclKind.Instance);
  const id = edge.kind === DeclKind.Instance ? edge.id : "";
  assert.deepEqual(parse(`namespace d { connector ${id} {} }`).diagnostics, []);
  assert.notEqual(parse(`namespace d { connector connector#1 {} }`).diagnostics.length, 0);
});

test("an application-connectors block gets a lexer-valid container id", () => {
  const { namespace } = parse(`namespace d { model m : ea { connectors { a --> b } } }`);
  // The connectors container id must be a valid identifier (no '#', no '-').
  // Re-parse it as an instance header to confirm it lexes clean.
  // (Reach the block via the model's instances; assert its id shape.)
  const decl = namespace.declarations[0]!;
  assert.ok(decl.kind === DeclKind.Model);
  if (decl.kind === DeclKind.Model) {
    const block = decl.instances.find((i) => i.concept === "connectors")!;
    assert.match(block.id, /^application_connectors_\d+$/);
    assert.deepEqual(parse(`namespace d { connectors ${block.id} {} }`).diagnostics, []);
  }
});
```

If `ModelDecl` is needed for the last test's type-narrowing, import it: `import { DeclKind, ValueKind, type NameValue, type ModelDecl } from "../ast.js";` and narrow with `decl.kind === DeclKind.Model`. Confirm the model's nested instances live on `.instances` (see `src/parse/tests/parser.test.ts:125-136`, which reads `model.instances`).

- [ ] **Step 2: Run — expect failures on operator + id shape**

Run: `npx tsx --conditions=development --test --test-force-exit src/parse/tests/edge-record.test.ts`
Expected: FAIL — current parser injects `operator` (so `find(...operator)` is defined) and ids are `connector#1` / `application-connectors#1` (so `/^connector_\d+$/` and the re-parse-clean assertions fail).

- [ ] **Step 3: Implement the parser changes**

In `src/parse/parser.ts` `parseEdgeRecord`, remove the operator assignment so the list is:

```ts
    const assignments: AssignmentNode[] = [
      { name: fromField, value: { kind: ValueKind.Name, name: from } },
      { name: toField, value: { kind: ValueKind.Name, name: to } },
    ];
```

(The `const operator = this.consumeEdgeOperator();` line stays — the arrow is still consumed, just not stored.)

Change the id line from:

```ts
    const id = `${concept}#${(this.edgeSeq += 1)}`;
```
to:
```ts
    const id = `${concept}_${(this.edgeSeq += 1)}`;
```

In `parseApplicationConnectors`, change:

```ts
    const id = `application-connectors#${(this.edgeSeq += 1)}`;
```
to:
```ts
    const id = `application_connectors_${(this.edgeSeq += 1)}`;
```

- [ ] **Step 4: Run the edge-record tests — expect pass**

Run: `npx tsx --conditions=development --test --test-force-exit src/parse/tests/edge-record.test.ts`
Expected: all PASS.

- [ ] **Step 5: Full suite green**

Run: `npm test`
Expected: all green. `parseEdgeRecord` is shared; if any existing test asserted the old `operator` attr or a `#`-id, update it to the new shape (grep found none, but the run is the check).

- [ ] **Step 6: Commit**

```bash
git add src/parse/parser.ts src/parse/tests/edge-record.test.ts
git commit -m "fix(parse): drop dead edge operator attr; lexer-valid synthetic ids

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Strip dead `operator` lines from the data

**Files:**
- Create: `scripts/strip-edge-operator.ts`

**Interfaces:**
- Produces: CLI `npx tsx --conditions=development scripts/strip-edge-operator.ts <file...>` — removes whole `operator = "…";` lines in place, prints per-file removal count.

- [ ] **Step 1: Write the strip script**

Create `scripts/strip-edge-operator.ts`:

```ts
// Remove dead `operator = "…";` lines (the synthetic edge-arrow attr) from
// each given .todl file, in place. Nothing declares or reads `operator`.
// Usage: npx tsx --conditions=development scripts/strip-edge-operator.ts <file...>
import { readFileSync, writeFileSync } from "node:fs";

const line = /^[ \t]*operator[ \t]*=[ \t]*"[^"]*"[ \t]*;[ \t]*\r?\n/gm;

for (const file of process.argv.slice(2)) {
  const before = readFileSync(file, "utf8");
  const matches = before.match(line);
  const after = before.replace(line, "");
  writeFileSync(file, after);
  console.log(`${file}: ${matches ? matches.length : 0} removed`);
}
```

- [ ] **Step 2: Run it on the data files**

Run:
```bash
P="C:/Users/Eugene/Projects/plexus_tests"
npx tsx --conditions=development scripts/strip-edge-operator.ts "$P/architecures/test_architecture/landscape.todl" "$P/architecures/test_architecture/model.todl"
```
Expected: `landscape.todl: 42 removed`, `model.todl: 0 removed`. If landscape's count is not 42, the data changed since planning — inspect before continuing (do not blindly proceed).

- [ ] **Step 3: Re-run the data gate — expect 0**

Run the Global-Constraints data-gate command.
Expected: `total: 0  data-file: 0`, exit 0. (Removing an undeclared attr cannot introduce a diagnostic; this confirms nothing else shifted.)

- [ ] **Step 4: Commit the script**

```bash
git add scripts/strip-edge-operator.ts
git commit -m "feat(sp4): strip dead edge operator attr from architecture data

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Final gate + report

- [ ] **Step 1: Full suite + data gate**

Run: `npm test` (expected: green, prior count + 4 new edge-record tests).
Run the data-gate command (expected: `data-file: 0`).

- [ ] **Step 2: Report + handoff**

- Parser no longer injects the dead `operator` attr and mints lexer-valid ids (`connector_N`, `step_N`, `application_connectors_N`).
- `landscape.todl`: 42 `operator` lines stripped; project still validates 0 diagnostics.
- Committed TODL artifacts: `src/parse/parser.ts` change, `src/parse/tests/edge-record.test.ts`, `scripts/strip-edge-operator.ts`.
- **Deferred (YAGNI):** emitter edge-shorthand + full native-nested-step ↔ flattened round-trip (until the viz emits edges); `connector.type` retyping (SP2-class gap).
- **SP5 (Plexus):** bump to `@pragmatic-lab/todl@^0.24.0`, `.target`→`.targets` consumers, drop-factory required `label`, arch emitter must emit bare refs (else SP3 reverts) and must not re-introduce `operator` (else SP4 reverts), live in-app republish. **Risk:** if a Plexus consumer reads `operator`, stripping it surfaces there — verify during SP5.
- Do not push; do not start SP5 without approval.

## Self-Review

- **Spec coverage:** Component 1 (drop operator + lexer-valid ids) → Task 1 Step 3; Component 2 (strip script + gate 0) → Task 2; Component 3 (parser tests + id round-trip) → Task 1 Steps 1/3 (tests target the parser change; the instance emit round-trip is covered by the unchanged `todl.test.ts`, noted here as a deliberate, transparent narrowing of the spec's "emitModelTodl round-trip" to the actual SP4 change); out-of-scope/risks → Task 3 Step 2.
- **Placeholder scan:** both the parser diff and the script are given in full; the one conditional (import `ModelDecl` if needed; confirm `.instances`) carries an exact reference (`parser.test.ts:125-136`). No TBDs.
- **Type consistency:** id forms `${concept}_${n}` / `application_connectors_${n}` identical across Global Constraints, Task 1 Step 3, and the test regexes; `parse` returns `{ namespace, diagnostics }` used consistently; the data-gate command is identical to SP3's.
