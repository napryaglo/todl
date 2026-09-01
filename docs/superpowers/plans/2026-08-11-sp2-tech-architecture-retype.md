# Retype tech-architecture Reference Endpoints (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retype every `tech_architecture` meta-model field that references another concept from the `identifier` primitive (unchecked) to a real reference member — union relationships for multi-target endpoints, concept-typed fields for single-target ones — then bump + publish TODL 0.24.0.

**Architecture:** Content edits to `.todl` files under `C:\Users\Eugene\Projects\plexus_tests\meta-models\tech-architecture\` (not a git repo — edits are on-disk, verified by a headless load-check), plus a committed TODL regression test and a version bump in the TODL repo. The load-check (`scripts/check-metamodel.ts`) globs the meta-model, runs it through `check()` (prelude injected), and reports diagnostics. Baseline is **0**; every task must keep it **0**.

**Tech Stack:** TypeScript (ESM, strict), TODL compiler `@pragmatic-tech-ai/todl`. Runner: `tsx --conditions=development --test`. Verdaccio at `http://localhost:4873/`.

## Global Constraints

- Meta-model dir `plexus_tests/meta-models/tech-architecture/` is **not a git repository**: `.todl` edits are on-disk, not committed. Only TODL-repo artifacts (regression test, `scripts/check-metamodel.ts`, version bump, spec, plan) are committed on branch `feat/sp2-tech-architecture-retype`.
- Baseline meta-model diagnostics = **0**. Acceptance for every content task: load-check still reports **0**.
- Every TODL test file lives in a `tests/` subfolder next to its source.
- Real TypeScript `enum`s, never string-literal unions.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- `npm publish` targets local Verdaccio only. No git push.
- Load-check command (run from TODL repo root):
  `npx tsx --conditions=development scripts/check-metamodel.ts "C:/Users/Eugene/Projects/plexus_tests/meta-models/tech-architecture"`
- Union memberships (verbatim): `connector.from/to` → `actor | block | location | component | application`; `step.src/dst` and `sequence.entry_point` → `actor | block | component`.

---

### Task 1: Commit the load-check tool + a TODL regression test for the pattern

Lock the capability the meta-model relies on into the TODL suite (the meta-model content itself is unversioned), and commit the load-check script the rest of the plan uses. `scripts/check-metamodel.ts` already exists in the working tree from planning — verify its contents match below, then commit it with the test.

**Files:**
- Create/verify: `scripts/check-metamodel.ts`
- Test: `src/validate/tests/tech-architecture-pattern.test.ts`

**Interfaces:**
- Consumes: `check(sources)` from `src/api.js` → `{ model, diagnostics }`; `DiagnosticCode.TargetTypeMismatch` from `src/validate/validate.js`.
- Produces: nothing consumed by later tasks (safety net + tooling only).

- [ ] **Step 1: Verify the load-check script**

`scripts/check-metamodel.ts` must read (uses `check`, not raw `load`, so the prelude is injected):

```ts
// Headless meta-model load-check: glob every .todl under a directory, load them
// through the TODL loader as one project, and print diagnostics grouped by code.
// Usage: npx tsx --conditions=development scripts/check-metamodel.ts <dir>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { check } from "../src/api.js";

function todlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...todlFiles(p));
    else if (entry.endsWith(".todl")) out.push(p);
  }
  return out;
}

const dir = process.argv[2];
if (dir === undefined) { console.error("usage: check-metamodel <dir>"); process.exit(2); }

const files = todlFiles(dir).sort();
const { diagnostics } = check(files.map((uri) => ({ uri, text: readFileSync(uri, "utf8") })));

const byCode = new Map<string, number>();
for (const d of diagnostics) byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1);

console.log(`files: ${files.length}  diagnostics: ${diagnostics.length}`);
for (const [code, n] of [...byCode.entries()].sort()) console.log(`  ${code}: ${n}`);
console.log("--- detail ---");
for (const d of diagnostics) {
  const uri = String(d.span?.uri ?? "").split(/[\\/]/).pop();
  console.log(`  [${d.code}] ${uri}:${d.span?.start?.line ?? "?"}  ${d.message.split("\n")[0].slice(0, 120)}`);
}
```

- [ ] **Step 2: Write the failing regression test**

Create `src/validate/tests/tech-architecture-pattern.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { DiagnosticCode } from "../validate.js";

// Mirrors the tech-architecture connector shape: a union relationship endpoint
// plus a concept-typed single-target field. Locks the SP1 capability the
// meta-model leans on, since the meta-model content is not in any test suite.
const CONCEPTS = `namespace ta {
  concept actor {} concept block {} concept location {}
  concept component {} concept application {}
  concept connector {
    relationship from -> actor | block | location | component | application;
    delivered : component?;
  }
}`;

function diagnostics(extra: string) {
  return check([{ uri: "ta.todl", text: CONCEPTS.replace(/}\s*}$/, `${extra} } }`) }]).diagnostics;
}

test("a connector endpoint pointing at any union member and a typed field load clean", () => {
  const diags = diagnostics(`
    actor alice {}
    component web {}
    connector c1 { from = alice; delivered = web; }`);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.TargetTypeMismatch), []);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.ReferenceUndefined), []);
});

test("a connector endpoint outside the union is a TargetTypeMismatch naming the union", () => {
  const diags = diagnostics(`
    concept technology {}
    technology react {}
    connector c1 { from = react; }`);
  const mismatch = diags.filter((d) => d.code === DiagnosticCode.TargetTypeMismatch);
  assert.equal(mismatch.length, 1);
  assert.match(mismatch[0]!.message, /actor \| block \| location \| component \| application/);
});
```

- [ ] **Step 3: Run — verify it passes (capability already landed in SP1)**

Run: `npx tsx --conditions=development --test --test-force-exit src/validate/tests/tech-architecture-pattern.test.ts`
Expected: PASS both. If `DiagnosticCode.ReferenceUndefined` is not the exact enum name, open `src/validate/validate.ts` / `src/diagnostics/diagnostic.ts` and use the real member (the undefined-symbol code); adjust the test. If the `.replace(...)` splice mangles the source, inline the full source per test instead — the intent is: valid endpoints clean, out-of-union endpoint flagged.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-metamodel.ts src/validate/tests/tech-architecture-pattern.test.ts
git commit -m "test(sp2): lock the connector union+typed-field pattern; add meta-model load-check

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Retype the union endpoints (connector, step, sequence)

Convert the five multi-target endpoint fields to union relationships. These edit on-disk `.todl` files (not committed). Relationships go after the field block, matching the meta-model's own pattern (e.g. `concepts/component.todl`).

**Files (on-disk, not git-tracked):**
- `plexus_tests/meta-models/tech-architecture/concepts/connector.todl`
- `plexus_tests/meta-models/tech-architecture/concepts/step.todl`
- `plexus_tests/meta-models/tech-architecture/concepts/sequence.todl`

- [ ] **Step 1: connector — replace `from`/`to` fields with relationships**

In `concepts/connector.todl`, the fields block currently reads:

```
        from : identifier;
        to : identifier;
        scenario : identifier?;
        sequence : slug?;
        step : integer?;
        natural : string?;
```

Delete the `from` and `to` lines, leaving:

```
        scenario : identifier?;
        sequence : slug?;
        step : integer?;
        natural : string?;

        relationship from -> actor | block | location | component | application;
        relationship to   -> actor | block | location | component | application;
```

(Leave `scenario : identifier?;` unchanged here — it is retyped in Task 3.)

- [ ] **Step 2: step — replace `src`/`dst` fields with relationships**

In `concepts/step.todl`, replace:

```
        src : identifier;
        dst : identifier;
```

with:

```
        relationship src -> actor | block | component;
        relationship dst -> actor | block | component;
```

- [ ] **Step 3: sequence — replace `entry_point` field with a relationship**

In `concepts/sequence.todl`, the fields block reads:

```
        id          : identifier;
        entry_point : identifier;
        steps       : step[];
```

Change to (drop `entry_point` from the fields, add a relationship after `steps`):

```
        id          : identifier;
        steps       : step[];

        relationship entry_point -> actor | block | component;
```

- [ ] **Step 4: Reword the three resolution invariants**

The prose invariants that describe endpoint resolution are now compiler-enforced. Reword only the opening sentence so it does not read as the sole guard; keep the rest (app-tier conditional, qualified-form rule, cross-container note).

- `concepts/connector.todl`, first invariant — change the opening `Both \`from\` and \`to\` resolve to known actors, blocks, locations, components, or applications in the model.` to:
  `The compiler checks that \`from\` and \`to\` each reference a known actor, block, location, component, or application (a union relationship).`
- `concepts/step.todl`, invariant — change `Both \`src\` and \`dst\` resolve to known actors, blocks, or components in the model.` to:
  `The compiler checks that \`src\` and \`dst\` each reference a known actor, block, or component.`
- `concepts/sequence.todl`, first invariant — change `\`entry_point\` resolves to a known actor, block, or component in the model.` to:
  `The compiler checks that \`entry_point\` references a known actor, block, or component.`

- [ ] **Step 5: Run the load-check — expect 0**

Run: `npx tsx --conditions=development scripts/check-metamodel.ts "C:/Users/Eugene/Projects/plexus_tests/meta-models/tech-architecture"`
Expected: `files: 45  diagnostics: 0`. If a `TargetTypeMismatch` or `reference.undefined` appears, a target concept name is wrong or a taxonomy term set one of these members to a non-matching value — read the detail line, fix the offending `.todl`, re-run.

- [ ] **Step 6: Commit (TODL-repo artifacts only — record the edits in the plan is already done)**

No git-tracked files changed in this task (meta-model is unversioned). Do **not** create an empty commit. Proceed to Task 3; the version bump in Task 4 carries the plan/spec that document these edits. Note completion in the ledger.

---

### Task 3: Retype the single-target reference fields

Retype eight `identifier` fields to their target concept. Concept-typed fields are symbol-checked reference members — no relationship needed. On-disk edits only.

**Files (on-disk, not git-tracked):**
- `plexus_tests/meta-models/tech-architecture/concepts/connector.todl`
- `plexus_tests/meta-models/tech-architecture/concepts/container.todl`
- `plexus_tests/meta-models/tech-architecture/concepts/application.todl`
- `plexus_tests/meta-models/tech-architecture/concepts/network-peer.todl`

- [ ] **Step 1: connector.scenario**

In `concepts/connector.todl`, change `scenario : identifier?;` to `scenario : scenario?;`.

- [ ] **Step 2: container.delivered_by**

In `concepts/container.todl`, change `delivered_by   : identifier?;` to `delivered_by   : component?;`. Leave `deployed_into  : identifier[];` unchanged (documented exception — compound slot refs).

- [ ] **Step 3: application single-target fields**

In `concepts/application.todl`, change:

```
        containers  : identifier[];
        consumes    : identifier[];
        provides    : identifier[];
        contains    : identifier[];

        owner       : identifier?;
        enables     : identifier[];
```

to (leave `enables` as `identifier[]` — documented exception, BPMN process):

```
        containers  : container[];
        consumes    : component[];
        provides    : component[];
        contains    : application[];

        owner       : actor?;
        enables     : identifier[];
```

- [ ] **Step 4: network_peer.network**

In `concepts/network-peer.todl`, change `network : identifier;` to `network : network;`. (Field named `network` typed as concept `network` — the type reference resolves to the concept, not the field; the load-check confirms.)

- [ ] **Step 5: Run the load-check — expect 0**

Run: `npx tsx --conditions=development scripts/check-metamodel.ts "C:/Users/Eugene/Projects/plexus_tests/meta-models/tech-architecture"`
Expected: `files: 45  diagnostics: 0`. If `network : network;` produces a diagnostic (type resolves to the field, not the concept), fall back to leaving `network` typed but confirm with the detail line first; report the finding rather than guessing.

- [ ] **Step 6: Ledger note**

No git-tracked files changed. Record completion + the final load-check result (`diagnostics: 0`) in the ledger. Proceed to Task 4.

---

### Task 4: Bump + publish TODL 0.24.0

SP1's `target → targets` emit-shape change needs a published version for downstream republish. Plexus is pinned on its current minor, so publishing does not reach it until SP5.

**Files:**
- Modify: `package.json` (version, via `npm version`)

- [ ] **Step 1: Full suite green**

Run: `npm test`
Expected: all green (includes the Task 1 regression test; count = prior + 2).

- [ ] **Step 2: Bump the version**

Run: `npm version minor -m "release: v%s — union relationship targets + tech-architecture retype"`
Expected: version becomes `0.24.0`; a commit + tag `v0.24.0` are created.

- [ ] **Step 3: Publish to Verdaccio**

Run: `npm publish --registry http://localhost:4873/`
Expected: `+ @pragmatic-tech-ai/todl@0.24.0` (`prepublishOnly` runs `clean && build` first). If it errors that 0.24.0 already exists, the version was published earlier — verify with `npm view @pragmatic-tech-ai/todl@0.24.0 version --registry http://localhost:4873/` and proceed.

- [ ] **Step 4: Verify the published emit shape carries `targets`**

Run: `npm view @pragmatic-tech-ai/todl@0.24.0 version --registry http://localhost:4873/`
Expected: prints `0.24.0`. (The emit-shape itself is covered by the TODL suite's `js-module` tests; this step only confirms the publish landed.)

- [ ] **Step 5: Commit the plan/spec artifacts if not already committed**

```bash
git add docs/superpowers/plans/2026-08-11-sp2-tech-architecture-retype.md
git commit -m "docs(sp2): implementation plan for tech-architecture retype

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(The `npm version` commit already captured `package.json`; the spec was committed during brainstorming.)

---

### Task 5: Final report

- [ ] **Step 1: Confirm end state**

- Meta-model load-check: `diagnostics: 0` (13 fields retyped: 5 union relationships + 8 concept-typed fields).
- TODL suite green; `@pragmatic-tech-ai/todl@0.24.0` published to Verdaccio; tag `v0.24.0`.
- Documented exceptions untouched: `container.deployed_into`, `application.enables`, `meta.meta_model`, all `id` fields.

- [ ] **Step 2: Surface the SP3/SP5 handoff**

- **SP3:** migrate instance data — `landscape.todl` / `model.todl` now fail (quoted-string refs on the retyped members); rewrite quoted refs to bare names and re-emit.
- **SP5:** bump Plexus to `@pragmatic-tech-ai/todl@^0.24.0`, update relationship `.target` → `.targets` consumers (`deriveClasses` + typed clients), drop-factory required `label`, and perform the live in-app republish of tech-architecture.
- Do not push; do not start SP3/SP5 without approval.

## Self-Review

- **Spec coverage:** Section 1 union relationships → Task 2; Section 1 single-target fields → Task 3; Section 1 exceptions → left untouched, listed in Tasks 2/3/5; Section 2 invariants → Task 2 Step 4 (union endpoints reworded; single-target invariants like "If `owner` is set, it resolves to a known actor" already read as conditions and stay as-is); Section 3 baseline/load-check → Global Constraints + every content task's load-check step; Section 3 bump/publish → Task 4; Section 4 testing → Task 1 (regression) + load-check gates + Task 4 Step 1 (suite); Section 5 out-of-scope → Task 5 handoff.
- **Placeholder scan:** the regression test's `DiagnosticCode.ReferenceUndefined` name and the `.replace` splice are flagged with an exact fallback (use the real enum member / inline the source) rather than left vague. No TBDs.
- **Type consistency:** load-check command string, union memberships, and version `0.24.0` are identical across Global Constraints and every task. `check()` (not `load()`) used everywhere so the prelude is injected — the reason the baseline is 0.
