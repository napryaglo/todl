# Migrate Architecture Data Refs quoted → bare (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert quoted-string reference values on the 13 SP2-retyped members in the `test_architecture` data to bare names, so the model validates clean against the retyped tech-architecture meta-model.

**Architecture:** Two committed `npx tsx` scripts in the TODL repo — `scripts/migrate-arch-refs.ts` (surgical quoted→bare regex on the 13 members) and `scripts/check-project.ts` (loads meta-model + libraries + data via `check()`, reports data-scoped diagnostics, exits non-zero if any). Plus a TODL regression test locking the drop-on-quoted-string semantics. The data files in `plexus_tests` (not a git repo) are rewritten in place by running the migration script.

**Tech Stack:** TypeScript (ESM, strict), TODL compiler `@pragmatic-lab/todl`. Runner: `tsx --conditions=development --test`.

## Global Constraints

- Data dir `plexus_tests/architecures/test_architecture/` is **not a git repository**: its `.todl` edits are on-disk (produced by running the committed migration script), not version-controlled. Only TODL-repo artifacts (the two scripts, the regression test, spec, plan) are committed on branch `feat/sp3-arch-data-migration`.
- The 13 retyped members (verbatim): `from`, `to`, `src`, `dst`, `entry_point`, `scenario`, `delivered_by`, `owner`, `network`, `containers`, `consumes`, `provides`, `contains`. **Never** migrate `deployed_into` or `enables` (SP2 exceptions — still `identifier`).
- Measured baseline: **90** data-file diagnostics before (all `cardinality.required-missing`); **111** conversions (all in `landscape.todl`; `model.todl` = 0); **0** data-file diagnostics after.
- Load-checks use `check()` (from `src/api.js`) so the prelude is injected — raw `load()` reports `identifier`/`label`/`slug` undefined.
- Every TODL test file lives in a `tests/` subfolder next to its source.
- Real TypeScript `enum`s. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No `npm publish`, no git push, no TODL version bump.
- Paths (bash, from TODL repo root): `P="C:/Users/Eugene/Projects/plexus_tests"`; meta-model dir `$P/meta-models/tech-architecture`; data dir `$P/architecures/test_architecture`; libraries `$P/libraries/microsoft/microsoft.todl` and `$P/libraries/aws/aws.todl`.

---

### Task 1: Project load-check script (the gate)

Build the diagnostic gate first: it must detect the current broken state (90 diagnostics) so we can prove the migration fixes it.

**Files:**
- Create: `scripts/check-project.ts`

**Interfaces:**
- Consumes: `check(sources)` from `src/api.js` → `{ model, diagnostics }`. Each diagnostic has `.code: string`, `.message: string`, `.span?: { uri: string; start?: { line: number } }`.
- Produces: CLI `npx tsx --conditions=development scripts/check-project.ts <metaModelDir> <dataDir> <libFile...>` — prints data-scoped diagnostics, exits `1` if any, `0` if none.

- [ ] **Step 1: Write the script**

Create `scripts/check-project.ts`:

```ts
// Validate an architecture project: load the meta-model dir + named library
// files + the project's data dir into one graph via check() (prelude injected),
// and report diagnostics scoped to the data dir. Exit 1 if any.
// Usage: npx tsx --conditions=development scripts/check-project.ts <metaModelDir> <dataDir> <libFile...>
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

const [metaDir, dataDir, ...libs] = process.argv.slice(2);
if (metaDir === undefined || dataDir === undefined) {
  console.error("usage: check-project <metaModelDir> <dataDir> <libFile...>");
  process.exit(2);
}

const norm = (p: string) => p.replace(/\\/g, "/");
const dataPaths = todlFiles(dataDir);
const allPaths = [...todlFiles(metaDir), ...libs, ...dataPaths];
const { diagnostics } = check(allPaths.map((uri) => ({ uri, text: readFileSync(uri, "utf8") })));

const dataSet = new Set(dataPaths.map(norm));
const data = diagnostics.filter((d) => dataSet.has(norm(String(d.span?.uri ?? ""))));

const byCode = new Map<string, number>();
for (const d of data) byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1);
console.log(`total: ${diagnostics.length}  data-file: ${data.length}`);
for (const [code, n] of [...byCode.entries()].sort()) console.log(`  ${code}: ${n}`);
for (const d of data.slice(0, 40)) {
  const u = norm(String(d.span?.uri ?? "")).split("/").pop();
  console.log(`  [${d.code}] ${u}:${d.span?.start?.line ?? "?"}  ${d.message.split("\n")[0].slice(0, 100)}`);
}
process.exit(data.length > 0 ? 1 : 0);
```

- [ ] **Step 2: Run it against the current (unmigrated) data — expect 90**

Run:
```bash
P="C:/Users/Eugene/Projects/plexus_tests"
npx tsx --conditions=development scripts/check-project.ts "$P/meta-models/tech-architecture" "$P/architecures/test_architecture" "$P/libraries/microsoft/microsoft.todl" "$P/libraries/aws/aws.todl"
```
Expected: `data-file: 90`, all `cardinality.required-missing`, and exit code 1. This proves the gate detects the broken state. If the count differs, the data changed since planning — stop and re-examine before migrating.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-project.ts
git commit -m "feat(sp3): architecture-project load-check gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Migration script + apply it

**Files:**
- Create: `scripts/migrate-arch-refs.ts`

**Interfaces:**
- Consumes: nothing from TODL src (pure text transform).
- Produces: CLI `npx tsx --conditions=development scripts/migrate-arch-refs.ts <file...>` — rewrites each file in place, prints per-file conversion count and any skipped list-literal lines.

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate-arch-refs.ts`:

```ts
// Surgical quoted -> bare migration for the 13 SP2-retyped reference members.
// Rewrites each given .todl file in place. Leaves every other byte unchanged;
// never touches deployed_into / enables (SP2 exceptions, still identifier).
// Usage: npx tsx --conditions=development scripts/migrate-arch-refs.ts <file...>
import { readFileSync, writeFileSync } from "node:fs";

const MEMBERS = [
  "from", "to", "src", "dst", "entry_point", "scenario", "delivered_by",
  "owner", "network", "containers", "consumes", "provides", "contains",
];
const quoted = new RegExp(`^(\\s*)(${MEMBERS.join("|")})(\\s*=\\s*)"([^"]+)"(\\s*;)`, "gm");
// A retyped member holding a list literal would need manual review; flag it.
const listLiteral = new RegExp(`^\\s*(${MEMBERS.join("|")})\\s*=\\s*\\[`, "gm");

for (const file of process.argv.slice(2)) {
  const before = readFileSync(file, "utf8");
  let n = 0;
  const after = before.replace(quoted, (_m, ind, mem, eq, val, semi) => { n++; return `${ind}${mem}${eq}${val}${semi}`; });
  const skipped = [...before.matchAll(listLiteral)].map((m) => m[1]);
  writeFileSync(file, after);
  console.log(`${file}: ${n} converted${skipped.length ? `  SKIPPED list-literals: ${skipped.join(", ")}` : ""}`);
}
```

- [ ] **Step 2: Run the migration on the two data files**

Run:
```bash
P="C:/Users/Eugene/Projects/plexus_tests"
npx tsx --conditions=development scripts/migrate-arch-refs.ts "$P/architecures/test_architecture/landscape.todl" "$P/architecures/test_architecture/model.todl"
```
Expected: `landscape.todl: 111 converted` and `model.todl: 0 converted`, with **no** `SKIPPED list-literals`. If a list-literal is skipped, stop and convert it by hand (bare each element), then re-run — do not leave a quoted ref on a retyped member.

- [ ] **Step 3: Re-run the gate — expect 0**

Run:
```bash
P="C:/Users/Eugene/Projects/plexus_tests"
npx tsx --conditions=development scripts/check-project.ts "$P/meta-models/tech-architecture" "$P/architecures/test_architecture" "$P/libraries/microsoft/microsoft.todl" "$P/libraries/aws/aws.todl"
```
Expected: `data-file: 0`, exit code 0. If any diagnostic remains, read its detail line: a `reference.undefined` means a bare id has no matching instance (a real data gap — report it, do not invent an instance); a `TargetTypeMismatch` means an endpoint points at a concept outside its union (report it).

- [ ] **Step 4: Commit the script (data files are unversioned)**

```bash
git add scripts/migrate-arch-refs.ts
git commit -m "feat(sp3): quoted->bare migration for retyped architecture refs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Regression test locking the semantics

The data is unversioned; lock *why* the migration is needed in the TODL suite.

**Files:**
- Test: `src/validate/tests/reference-value-migration.test.ts`

**Interfaces:**
- Consumes: `check` from `src/api.js`; `DiagnosticCode.RequiredMissing`, `DiagnosticCode.ReferenceUndefined`, `DiagnosticCode.TargetTypeMismatch` from `src/validate/validate.js`.

- [ ] **Step 1: Write the failing test**

Create `src/validate/tests/reference-value-migration.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { DiagnosticCode } from "../validate.js";

// A required relationship member; the migration's exact before/after shapes.
const CONCEPTS = `
  concept actor {}
  concept edge { relationship end -> actor; }`;

function diagnostics(body: string) {
  return check([{ uri: "m.todl", text: `namespace ta {${CONCEPTS}\n${body}\n}` }]).diagnostics;
}

test("a quoted-string value on a required relationship is dropped -> required-missing", () => {
  const diags = diagnostics(`
    actor a {}
    edge e1 { end = "a"; }`);
  const missing = diags.filter((d) => d.code === DiagnosticCode.RequiredMissing && d.message.includes("edge.end"));
  assert.equal(missing.length, 1);
});

test("the bare form resolves clean", () => {
  const diags = diagnostics(`
    actor a {}
    edge e1 { end = a; }`);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.RequiredMissing), []);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.ReferenceUndefined), []);
  assert.deepEqual(diags.filter((d) => d.code === DiagnosticCode.TargetTypeMismatch), []);
});
```

- [ ] **Step 2: Run — expect PASS (behavior already exists post-SP1/SP2)**

Run: `npx tsx --conditions=development --test --test-force-exit src/validate/tests/reference-value-migration.test.ts`
Expected: both PASS. If the required-missing message does not contain `edge.end`, print the diagnostics and match on the real `path`/`message` shape (it names the concept.member); adjust the `.includes(...)` accordingly — do not weaken the intent (a quoted string leaves the required relationship empty; bare resolves).

- [ ] **Step 3: Commit**

```bash
git add src/validate/tests/reference-value-migration.test.ts
git commit -m "test(sp3): quoted ref dropped to required-missing; bare resolves

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Final gate + report

- [ ] **Step 1: Full TODL suite green**

Run: `npm test`
Expected: all green (prior count + 2 new tests).

- [ ] **Step 2: Confirm the migrated data validates clean**

Run the Task 2 Step 3 gate command again.
Expected: `data-file: 0`, exit 0.

- [ ] **Step 3: Report + SP4/SP5 handoff**

- Migrated: `landscape.todl` (111 refs quoted→bare), `model.todl` (0); data validates clean against the retyped meta-model + microsoft + aws libraries.
- Committed TODL artifacts: `scripts/check-project.ts`, `scripts/migrate-arch-refs.ts`, `src/validate/tests/reference-value-migration.test.ts`.
- **SP4:** `landscape.todl` still carries `operator = "-->"` synthetic attrs and the connector/step edge-record round-trip (`#`-id, shorthand emit) is unresolved.
- **SP5:** the Plexus arch emitter must emit bare refs on regeneration (else the migration reverts), plus `.target`→`.targets` consumers, drop-factory required `label`, and the live in-app republish.
- Do not push; do not start SP4/SP5 without approval.

## Self-Review

- **Spec coverage:** migration script (spec §Components/1) → Task 2; project load-check (§Components/2) → Task 1; regression test (§Components/3) → Task 3; measured 90/111/0 gate (§Evidence, §Testing) → Task 1 Step 2, Task 2 Steps 2–3, Task 4; surgical-not-round-trip decision (§Why) → Task 2 (textual regex, no emitter); exceptions never migrated (§Constraints) → `MEMBERS` list excludes `deployed_into`/`enables`; out-of-scope SP4/SP5 (§Out of scope) → Task 4 Step 3.
- **Placeholder scan:** both scripts and the test are given in full; the only conditional ("if a list-literal is skipped", "if the message shape differs") carries an exact, concrete fallback. No TBDs.
- **Type consistency:** `MEMBERS` list identical to Global Constraints; the regex `^(\s*)(<members>)(\s*=\s*)"([^"]+)"(\s*;)` → `$1$2$3$4$5` drops quotes (group 4 is the unquoted value); `check()` used in both scripts and the test (prelude injected); `DiagnosticCode.RequiredMissing` / `ReferenceUndefined` / `TargetTypeMismatch` are the exact enum members.
