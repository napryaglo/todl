# TODL Tests & Demos — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the corpus foundation (`examples/`), the pure `shared/` verify + corpus layer, golden-snapshot tooling, and the `todl-demo` CLI — delivering use cases 2 (example corpus + regression) and 3 (CLI) with zero UI.

**Architecture:** One example corpus is the single source of truth. A pure, framework-agnostic `shared/` module compiles each example with the todl compiler, canonicalizes the output into a deterministic "golden" shape, and diffs it against a committed snapshot. Node-only tooling generates the browser-safe corpus module and (re)writes goldens. A thin CLI and a node regression test both consume the same pure verify path.

**Tech Stack:** TypeScript (ESM, strict), `tsx` test runner (`node:test` + `node:assert/strict`), the `@pragmatic-tech-ai/todl` compiler consumed via package self-reference under the `development` export condition.

**Spec:** `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md`

## Global Constraints

- **Package boundary:** none of `examples/`, `shared/`, `cli/` may be added to the root `package.json` `files` array. The published npm package stays lean.
- **`shared/` purity:** `shared/` imports only the todl compiler and pure JS. No `node:fs`, no DOM, no Mural. It must run unchanged in a browser (Phase 2 depends on this).
- **Node-only tooling** (filesystem access) lives under `examples/tools/` and `scripts/`, never in `shared/`.
- **Compiler import path:** import the compiler as `@pragmatic-tech-ai/todl` (package self-reference), never by relative `../src/...` path. Under `tsx --conditions=development` this resolves to `src/`.
- **Node floor:** `>=20` (matches root `engines`). ESM only (`"type": "module"`).
- **Determinism is load-bearing:** golden output must be identical across runs. Achieved by canonical id remapping in `normalize` (below), NOT by trusting the compiler's id generator.
- **Test command for this work:** `tsx --conditions=development --test "shared/**/*.test.ts" "examples/**/*.test.ts" "cli/**/*.test.ts"` (wired as `test:corpus`). The existing `test` script globs `src/**` only and is unchanged.

---

## File Structure

- `shared/corpus-types.ts` — pure data types (`ExampleManifest`, `ExampleSource`, `Golden`, `CorpusEntry`, `VerifyResult`, `VerifySummary`). No logic.
- `shared/verify.ts` — pure: `DeterministicIdGenerator`, `normalize`, `verifyExample`, `verifyAll`. The heart of use case 2.
- `shared/corpus-access.ts` — pure accessors that take a corpus array as an argument (`byId`, `groups`, `byGroup`). Testable with a literal array.
- `shared/corpus.ts` — binds the accessors to the generated `CORPUS`. The one module that imports the generated file.
- `examples/corpus.generated.ts` — GENERATED (do not hand-edit). `export const CORPUS: CorpusEntry[]`.
- `examples/tools/load-from-disk.mts` — node-only: `loadExamplesFromDisk(root): CorpusEntry[]`. Reads `example.json`, source files, `golden.json`.
- `examples/tools/update-goldens.mts` — node-only: `updateGoldens(root): VerifySummary`. Compiles each example via `verifyExample({update:true})` and writes each `golden.json`. Exported for CLI reuse; also runnable as a script.
- `scripts/gen-corpus.mjs` — node-only (plain, like `gen-prelude.mjs`): walk `examples/`, emit `examples/corpus.generated.ts`.
- `examples/<category>/<id>/example.json | *.todl | golden.json` — the seed corpus.
- `examples/tests/corpus.test.ts` — the regression backbone: `verifyAll(CORPUS)` must be clean.
- `cli/package.json` — local package carrying the `todl-demo` bin (kept out of the root package).
- `cli/tsconfig.json` — typechecks CLI against the public todl surface.
- `cli/src/main.ts` — arg dispatch.
- `cli/src/commands/{list,run,test}.ts` — one file per command.
- `cli/src/format.ts` — stage headers, colorized diff, table formatting.
- Root `package.json` — new scripts: `gen:corpus`, `gen:goldens`, `test:corpus`, `cli`. New devDependency: none required beyond existing `tsx`/`rimraf` (CLI colors are hand-rolled ANSI, no dep).

---

## Task 1: Verify core (`shared/`)

The pure foundation: given an example (sources + committed golden), compile it, canonicalize the result, and diff. No filesystem, no corpus, no CLI — tests construct examples inline.

**Files:**
- Create: `shared/corpus-types.ts`
- Create: `shared/verify.ts`
- Test: `shared/tests/verify.test.ts`

**Interfaces:**
- Consumes (from `@pragmatic-tech-ai/todl`): `check(sources, idGen?)`, `checkAgainst(bases, sources, idGen?)`, `toJSONOwn(model, ownIds)`, types `SourceFile`, `Diagnostic`, `TodlDocument`. (All exported from the package index.)
- Produces:
  - `interface Golden { diagnostics: GoldenDiagnostic[]; document: TodlDocument }`
  - `class DeterministicIdGenerator { next(): string }`
  - `function normalize(input: { document: TodlDocument; diagnostics: readonly Diagnostic[] }): Golden`
  - `function verifyExample(entry: CorpusEntry, opts?: { update?: boolean }): VerifyResult`
  - `function verifyAll(entries: readonly CorpusEntry[], opts?: { update?: boolean }): VerifySummary`

- [ ] **Step 1: Write `shared/corpus-types.ts`**

```ts
// Pure data types shared by the corpus, verify, CLI, and (Phase 2) the app.
// No logic lives here — see verify.ts / corpus-access.ts.
import type { TodlDocument } from "@pragmatic-tech-ai/todl";

/** One source file inside an example; `name` is its load identity (uri). */
export interface ExampleSource { name: string; text: string; }

/** The hand-authored manifest (example.json). */
export interface ExampleManifest {
  id: string;
  title: string;
  group: string;
  order: number;
  tags: string[];
  /** Markdown shown above the snippet in the docs showcase. */
  narrative: string;
  /** Load order; each entry is a filename in the example folder. */
  files: string[];
  /** Files (subset of `files`) compiled as already-published bases. */
  bases?: string[];
  /** Human-readable intent flag; the golden is authoritative. */
  expectClean: boolean;
}

/** A diagnostic reduced to the stable fields we snapshot. */
export interface GoldenDiagnostic {
  code: string;
  severity: string;
  message: string;
  span: { uri: string; start: { line: number; column: number }; end: { line: number; column: number } } | null;
  path: string | null;
}

/** The committed expected output (golden.json), after canonicalization. */
export interface Golden {
  diagnostics: GoldenDiagnostic[];
  document: TodlDocument;
}

/** One corpus entry: manifest + sources + committed golden + on-disk dir. */
export interface CorpusEntry {
  manifest: ExampleManifest;
  sources: ExampleSource[];
  golden: Golden;
  /** Repo-relative folder, e.g. "examples/resolution/taxonomy-bare". Used by
   *  the node update tool to know where to write golden.json; ignored elsewhere. */
  dir: string;
}

export type VerifyStatus = "pass" | "fail" | "updated";

export interface VerifyResult {
  id: string;
  status: VerifyStatus;
  /** Present when status === "fail": a human-readable diff. */
  diff?: string;
  /** Present when status === "updated": the freshly computed golden to write. */
  golden?: Golden;
}

export interface VerifySummary {
  passed: number;
  failed: number;
  updated: number;
  results: VerifyResult[];
}
```

- [ ] **Step 2: Write the failing tests** in `shared/tests/verify.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExample, normalize, verifyAll } from "../verify.js";
import type { CorpusEntry } from "../corpus-types.js";

// Build an entry whose golden we compute now, so a re-run must match it.
function entryFor(id: string, files: { name: string; text: string }[], manifest?: Partial<CorpusEntry["manifest"]>): CorpusEntry {
  const base: CorpusEntry = {
    manifest: { id, title: id, group: "Test", order: 0, tags: [], narrative: "", files: files.map(f => f.name), expectClean: true, ...manifest },
    sources: files,
    golden: { diagnostics: [], document: { nodes: [], edges: [] } },
    dir: `examples/test/${id}`,
  };
  // Seed the golden from a first run (update path), then verifying must pass.
  const updated = verifyExample(base, { update: true });
  return { ...base, golden: updated.golden! };
}

test("a clean example verifies as pass against its own generated golden", () => {
  const e = entryFor("clean", [
    { name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "x"; } }` },
  ]);
  const r = verifyExample(e);
  assert.equal(r.status, "pass", r.diff);
});

test("verification is deterministic across repeated runs (canonical ids)", () => {
  const files = [{ name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "x"; } }` }];
  const a = verifyExample(entryFor("d1", files), {});
  const b = verifyExample(entryFor("d2", files), {});
  assert.equal(a.status, "pass");
  assert.equal(b.status, "pass");
});

test("an example with an intentional error snapshots its diagnostics", () => {
  const e = entryFor("err", [
    // Missing required `label` → a cardinality diagnostic.
    { name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { } }` },
  ], { expectClean: false });
  assert.ok(e.golden.diagnostics.length >= 1, "golden should capture the error");
  assert.equal(verifyExample(e).status, "pass");
});

test("drift is detected: a changed source fails against a stale golden", () => {
  const e = entryFor("drift", [
    { name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "x"; } }` },
  ]);
  const tampered: CorpusEntry = { ...e, sources: [{ name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "y"; } }` }] };
  const r = verifyExample(tampered);
  assert.equal(r.status, "fail");
  assert.ok(typeof r.diff === "string" && r.diff.length > 0);
});

test("normalize emits only own nodes, never the prelude bulk", () => {
  const e = entryFor("own", [
    { name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "x"; } }` },
  ]);
  // Prelude has many nodes; own doc here is small (concept + instance).
  assert.ok(e.golden.document.nodes.length < 10);
});

test("verifyAll aggregates a summary", () => {
  const files = [{ name: "m.todl", text: `namespace app { concept C { label : string; } C c { label = "x"; } }` }];
  const s = verifyAll([entryFor("a", files), entryFor("b", files)]);
  assert.equal(s.failed, 0);
  assert.equal(s.passed, 2);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --conditions=development --test "shared/tests/verify.test.ts"`
Expected: FAIL — `Cannot find module '../verify.js'`.

- [ ] **Step 4: Write `shared/verify.ts`**

```ts
// Pure verification: compile an example, canonicalize its output into a stable
// "golden" shape, and diff against the committed snapshot. NO filesystem — the
// node update tool handles writes. This module must run in a browser (Phase 2).
import {
  check, checkAgainst, toJSONOwn,
  type SourceFile, type Diagnostic, type TodlDocument,
} from "@pragmatic-tech-ai/todl";
import type { CorpusEntry, Golden, GoldenDiagnostic, VerifyResult, VerifySummary } from "./corpus-types.js";

/** Deterministic id source. The compiler's default is Snowflake (wall-clock),
 *  and even the prelude is compiled with it, so ids differ every run. We inject
 *  this for the source AND canonically remap ALL ids in normalize (below), so
 *  prelude/base ids referenced by own nodes are stable too. */
export class DeterministicIdGenerator {
  private n = 0;
  next(): string { return `g${this.n++}`; }
}

function toSourceFiles(entry: CorpusEntry): { bases: SourceFile[]; sources: SourceFile[] } {
  const baseNames = new Set(entry.manifest.bases ?? []);
  const byName = new Map(entry.sources.map((s) => [s.name, s]));
  const bases: SourceFile[] = [];
  const sources: SourceFile[] = [];
  for (const name of entry.manifest.files) {
    const src = byName.get(name);
    if (!src) throw new Error(`example ${entry.manifest.id}: manifest lists "${name}" but no such source`);
    (baseNames.has(name) ? bases : sources).push({ uri: name, text: src.text });
  }
  return { bases, sources };
}

/** Rewrite every id in the document to a canonical placeholder, so goldens are
 *  independent of the compiler's (non-deterministic) id generator. Own nodes
 *  come first in emission order (`#n0..`); any remaining referenced ids
 *  (prelude/base) are numbered in first-appearance order (`#r0..`). */
function canonicalizeIds(doc: TodlDocument): TodlDocument {
  const map = new Map<string, string>();
  const own = (id: string): string => {
    let c = map.get(id);
    if (c === undefined) { c = `#n${map.size}`; map.set(id, c); }
    return c;
  };
  // Pass 1: own node ids in emission order.
  for (const node of doc.nodes) own(node.id);
  // Pass 2: referenced ids (typeOf, edge endpoints, via) — assigned after all
  // own ids, so own numbering never shifts when references change.
  const refs = new Map<string, string>();
  const ref = (id: string | null): string | null => {
    if (id === null) return null;
    if (map.has(id)) return map.get(id)!;
    let c = refs.get(id);
    if (c === undefined) { c = `#r${refs.size}`; refs.set(id, c); }
    return c;
  };
  const nodes = doc.nodes.map((n) => ({ id: map.get(n.id)!, tier: n.tier, typeOf: ref(n.typeOf)!, attrs: n.attrs }));
  const edges = doc.edges.map((e) => ({ kind: e.kind, via: ref(e.via), from: ref(e.from)!, to: ref(e.to)! }));
  return { nodes, edges };
}

function canonicalDoc(doc: TodlDocument): TodlDocument {
  const c = canonicalizeIds(doc);
  const nodes = [...c.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...c.edges].sort((a, b) =>
    (a.from + a.via + a.kind + a.to).localeCompare(b.from + (b.via ?? "") + b.kind + b.to));
  return { nodes, edges };
}

function canonicalDiagnostics(diags: readonly Diagnostic[]): GoldenDiagnostic[] {
  return diags
    .map((d): GoldenDiagnostic => ({
      code: d.code, severity: d.severity, message: d.message, path: d.path,
      span: d.span ? { uri: d.span.uri, start: d.span.start, end: d.span.end } : null,
    }))
    .sort((a, b) => {
      const ua = a.span?.uri ?? "", ub = b.span?.uri ?? "";
      if (ua !== ub) return ua.localeCompare(ub);
      const la = a.span?.start.line ?? 0, lb = b.span?.start.line ?? 0;
      if (la !== lb) return la - lb;
      const ca = a.span?.start.column ?? 0, cb = b.span?.start.column ?? 0;
      if (ca !== cb) return ca - cb;
      return a.code.localeCompare(b.code);
    });
}

export function normalize(input: { document: TodlDocument; diagnostics: readonly Diagnostic[] }): Golden {
  return { diagnostics: canonicalDiagnostics(input.diagnostics), document: canonicalDoc(input.document) };
}

function compile(entry: CorpusEntry): Golden {
  const { bases, sources } = toSourceFiles(entry);
  const idGen = new DeterministicIdGenerator();
  const { model, diagnostics, provenance } =
    bases.length > 0
      ? checkAgainst(basesToDocuments(bases), sources, idGen)
      : check(sources, idGen);
  // Own nodes = those the sources authored (present in provenance). Excludes
  // prelude/base nodes, keeping the golden focused.
  const ownIds = new Set(provenance.keys());
  return normalize({ document: toJSONOwn(model, ownIds), diagnostics });
}

// Bases arrive as raw source here (authoring style); compile them standalone to
// TodlDocuments so checkAgainst can seed the graph. Base ids are canonicalized
// away in normalize, so their non-determinism does not leak into goldens.
function basesToDocuments(bases: SourceFile[]) {
  const { toJSON } = requireTodl();
  return bases.map((b) => {
    const { model } = check([b], new DeterministicIdGenerator());
    return toJSON(model);
  });
}

// Local indirection so the top-of-file import list stays the documented public
// surface; toJSON is only needed for the bases path.
function requireTodl(): { toJSON: (m: unknown) => TodlDocument } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return { toJSON: (globalThis as any).__todlToJSON } as any;
}

function diffGolden(a: Golden, b: Golden): string | undefined {
  const sa = JSON.stringify(a, null, 2), sb = JSON.stringify(b, null, 2);
  if (sa === sb) return undefined;
  return `--- expected (golden)\n+++ actual\n${sa}\n=====\n${sb}`;
}

export function verifyExample(entry: CorpusEntry, opts: { update?: boolean } = {}): VerifyResult {
  const actual = compile(entry);
  if (opts.update) return { id: entry.manifest.id, status: "updated", golden: actual };
  const diff = diffGolden(entry.golden, actual);
  return diff ? { id: entry.manifest.id, status: "fail", diff } : { id: entry.manifest.id, status: "pass" };
}

export function verifyAll(entries: readonly CorpusEntry[], opts: { update?: boolean } = {}): VerifySummary {
  const results = entries.map((e) => verifyExample(e, opts));
  return {
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    updated: results.filter((r) => r.status === "updated").length,
    results,
  };
}
```

> **Implementer note on `basesToDocuments`:** the `requireTodl()` indirection above is a placeholder to avoid confusion — replace it by simply adding `toJSON` to the top import from `@pragmatic-tech-ai/todl` and calling `toJSON(model)` directly. `toJSON` IS exported from the package index (verified). Delete `requireTodl` entirely. (It is written this way only to flag that the bases path needs `toJSON`; do not ship the indirection.)

- [ ] **Step 5: Simplify the bases path**

Replace the top import with `import { check, checkAgainst, toJSON, toJSONOwn, type SourceFile, type Diagnostic, type TodlDocument } from "@pragmatic-tech-ai/todl";`, rewrite `basesToDocuments` to call `toJSON(model)` directly, and delete `requireTodl`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test "shared/tests/verify.test.ts"`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add shared/corpus-types.ts shared/verify.ts shared/tests/verify.test.ts
git commit -m "feat(demos): pure verify core with canonical golden normalization"
```

---

## Task 2: Corpus accessors + node load/generate tooling

Pure accessors (testable with a literal corpus) plus the node-only plumbing that reads examples from disk, generates the browser-safe `corpus.generated.ts`, and writes goldens.

**Files:**
- Create: `shared/corpus-access.ts`
- Create: `shared/corpus.ts`
- Create: `examples/tools/load-from-disk.mts`
- Create: `examples/tools/update-goldens.mts`
- Create: `scripts/gen-corpus.mjs`
- Test: `shared/tests/corpus-access.test.ts`
- Test: `examples/tools/tests/load-from-disk.test.mts`
- Fixture: `examples/_fixture/clean-instance/{example.json,m.todl,golden.json}`

**Interfaces:**
- Consumes: `CorpusEntry` (Task 1), `verifyExample` (Task 1).
- Produces:
  - `function byId(corpus: readonly CorpusEntry[], id: string): CorpusEntry | undefined`
  - `function groups(corpus: readonly CorpusEntry[]): string[]`
  - `function byGroup(corpus: readonly CorpusEntry[]): Map<string, CorpusEntry[]>`
  - `loadExamplesFromDisk(root: string): CorpusEntry[]`
  - `updateGoldens(root: string): VerifySummary`
  - generated `CORPUS` in `examples/corpus.generated.ts`

- [ ] **Step 1: Write failing accessor tests** in `shared/tests/corpus-access.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { byId, groups, byGroup } from "../corpus-access.js";
import type { CorpusEntry } from "../corpus-types.js";

const mk = (id: string, group: string, order: number): CorpusEntry => ({
  manifest: { id, title: id, group, order, tags: [], narrative: "", files: [], expectClean: true },
  sources: [], golden: { diagnostics: [], document: { nodes: [], edges: [] } }, dir: `examples/x/${id}`,
});
const corpus = [mk("b", "G2", 1), mk("a", "G1", 2), mk("c", "G1", 1)];

test("byId finds by id", () => assert.equal(byId(corpus, "a")?.manifest.id, "a"));
test("byId misses cleanly", () => assert.equal(byId(corpus, "nope"), undefined));
test("groups are unique and sorted", () => assert.deepEqual(groups(corpus), ["G1", "G2"]));
test("byGroup buckets and orders within a group by manifest.order", () => {
  const g = byGroup(corpus);
  assert.deepEqual(g.get("G1")!.map((e) => e.manifest.id), ["c", "a"]);
});
```

- [ ] **Step 2: Run and confirm FAIL** — `npx tsx --conditions=development --test "shared/tests/corpus-access.test.ts"` → module not found.

- [ ] **Step 3: Write `shared/corpus-access.ts`**

```ts
import type { CorpusEntry } from "./corpus-types.js";

export function byId(corpus: readonly CorpusEntry[], id: string): CorpusEntry | undefined {
  return corpus.find((e) => e.manifest.id === id);
}

export function groups(corpus: readonly CorpusEntry[]): string[] {
  return [...new Set(corpus.map((e) => e.manifest.group))].sort((a, b) => a.localeCompare(b));
}

export function byGroup(corpus: readonly CorpusEntry[]): Map<string, CorpusEntry[]> {
  const out = new Map<string, CorpusEntry[]>();
  for (const g of groups(corpus)) {
    out.set(g, corpus.filter((e) => e.manifest.group === g).sort((a, b) => a.manifest.order - b.manifest.order));
  }
  return out;
}
```

- [ ] **Step 4: Run and confirm PASS** (4 tests).

- [ ] **Step 5: Write the fixture example** (needed to test disk loading)

`examples/_fixture/clean-instance/example.json`:
```json
{
  "id": "fixture-clean-instance",
  "title": "Fixture: a clean instance",
  "group": "Fixture",
  "order": 0,
  "tags": ["fixture"],
  "narrative": "Internal fixture for tooling tests — not a showcase example.",
  "files": ["m.todl"],
  "expectClean": true
}
```

`examples/_fixture/clean-instance/m.todl`:
```
namespace app { concept Component { label : string; } Component c { label = "x"; } }
```

`examples/_fixture/clean-instance/golden.json`: create as `{ "diagnostics": [], "document": { "nodes": [], "edges": [] } }` for now — Step 9 regenerates it correctly.

- [ ] **Step 6: Write `examples/tools/load-from-disk.mts`**

```ts
// Node-only: read the examples/ tree into CorpusEntry[]. Filesystem lives here,
// never in shared/. Folders whose name starts with "_" are tooling fixtures and
// are still loaded (the caller decides whether to include them).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CorpusEntry, ExampleManifest, Golden } from "../../shared/corpus-types.js";

export function loadExamplesFromDisk(root: string): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  for (const dir of findExampleDirs(root)) {
    const manifest = JSON.parse(readFileSync(join(dir, "example.json"), "utf8")) as ExampleManifest;
    const sources = manifest.files.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
    const goldenPath = join(dir, "golden.json");
    const golden: Golden = existsJson(goldenPath)
      ? JSON.parse(readFileSync(goldenPath, "utf8"))
      : { diagnostics: [], document: { nodes: [], edges: [] } };
    entries.push({ manifest, sources, golden, dir: relative(root, dir).split(sep).join("/") });
  }
  return entries.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

function findExampleDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let hasManifest = false;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "example.json") hasManifest = true;
    }
    if (hasManifest) out.push(d);
  };
  walk(root);
  return out;
}

function existsJson(p: string): boolean {
  try { statSync(p); return true; } catch { return false; }
}
```

- [ ] **Step 7: Write failing disk-load test** in `examples/tools/tests/load-from-disk.test.mts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadExamplesFromDisk } from "../load-from-disk.mjs";

const examplesRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("loads the fixture example with sources", () => {
  const entries = loadExamplesFromDisk(examplesRoot);
  const fx = entries.find((e) => e.manifest.id === "fixture-clean-instance");
  assert.ok(fx, "fixture should load");
  assert.equal(fx!.sources.length, 1);
  assert.match(fx!.sources[0].text, /concept Component/);
  assert.ok(fx!.dir.startsWith("_fixture/"));
});
```

- [ ] **Step 8: Run and confirm PASS** — `npx tsx --conditions=development --test "examples/tools/tests/load-from-disk.test.mts"`.

- [ ] **Step 9: Write `examples/tools/update-goldens.mts`**

```ts
// Node-only: recompute and write every example's golden.json. Reuses the pure
// verify path so what it writes is exactly what the regression test asserts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { verifyExample } from "../../shared/verify.js";
import type { VerifySummary } from "../../shared/corpus-types.js";
import { loadExamplesFromDisk } from "./load-from-disk.mjs";

export function updateGoldens(root: string): VerifySummary {
  const entries = loadExamplesFromDisk(root);
  const results = entries.map((entry) => {
    const r = verifyExample(entry, { update: true });
    writeFileSync(join(root, entry.dir, "golden.json"), JSON.stringify(r.golden, null, 2) + "\n", "utf8");
    return r;
  });
  return { passed: 0, failed: 0, updated: results.length, results };
}

// Runnable directly: `tsx examples/tools/update-goldens.mts`
if (process.argv[1] && process.argv[1].endsWith("update-goldens.mts")) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const s = updateGoldens(root);
  console.log(`updated ${s.updated} golden(s)`);
}
```

- [ ] **Step 10: Regenerate the fixture golden and confirm the fixture verifies**

Run: `npx tsx --conditions=development examples/tools/update-goldens.mts`
Then add a quick check to `load-from-disk.test.mts` (or a new `examples/tests/fixture.test.ts`):
```ts
import { verifyExample } from "../../shared/verify.js";
// inside a test:
const fx = loadExamplesFromDisk(examplesRoot).find((e) => e.manifest.id === "fixture-clean-instance")!;
assert.equal(verifyExample(fx).status, "pass");
```
Run the test → PASS. The fixture `golden.json` now holds real canonicalized output (a Component concept node + instance node, no diagnostics).

- [ ] **Step 11: Write `scripts/gen-corpus.mjs`** (plain node, mirrors `gen-prelude.mjs`)

```js
// Generate examples/corpus.generated.ts from the examples/ tree. Inlines every
// manifest, source text, and golden as constants so the browser (Phase 2) needs
// no filesystem and no fetch. Excludes _fixture/* (tooling-only). Mirrors
// scripts/gen-prelude.mjs. Run after gen:goldens.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../examples/", import.meta.url)); // win-safe

function dirs(d) {
  const out = [];
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) out.push(...dirs(p));
    else if (name === "example.json") out.push(d);
  }
  return out;
}

const entries = dirs(root)
  .map((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, "example.json"), "utf8"));
    const sources = manifest.files.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
    const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8"));
    const rel = relative(root, dir).split(sep).join("/");
    return { manifest, sources, golden, dir: rel };
  })
  .filter((e) => !e.dir.startsWith("_fixture/"))
  .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

const out =
  "// GENERATED from examples/ by scripts/gen-corpus.mjs — do not edit by hand.\n" +
  'import type { CorpusEntry } from "../shared/corpus-types.js";\n\n' +
  `export const CORPUS: CorpusEntry[] = ${JSON.stringify(entries, null, 2)};\n`;

writeFileSync(new URL("../examples/corpus.generated.ts", import.meta.url), out);
console.log(`wrote examples/corpus.generated.ts (${entries.length} examples)`);
```

- [ ] **Step 12: Run the generator; write `shared/corpus.ts`**

Run: `node scripts/gen-corpus.mjs` → writes `examples/corpus.generated.ts` (with the fixture excluded, this may be 0 examples until Task 3 — that is fine; the file still compiles).

```ts
// shared/corpus.ts — binds the pure accessors to the generated corpus.
import { CORPUS } from "../examples/corpus.generated.js";
import { byId as _byId, groups as _groups, byGroup as _byGroup } from "./corpus-access.js";

export { CORPUS };
export const byId = (id: string) => _byId(CORPUS, id);
export const groups = () => _groups(CORPUS);
export const byGroup = () => _byGroup(CORPUS);
```

- [ ] **Step 13: Commit**

```bash
git add shared/corpus-access.ts shared/corpus.ts examples/tools examples/_fixture examples/corpus.generated.ts shared/tests/corpus-access.test.ts
git commit -m "feat(demos): corpus accessors + disk load/generate/golden tooling"
```

---

## Task 3: Seed corpus + regression backbone

Author the real showcase examples, generate their goldens, wire the generated module, and add the node regression test that fails CI on output drift.

**Files:**
- Create: `examples/<category>/<id>/{example.json, *.todl, golden.json}` for the seed set below.
- Create: `examples/tests/corpus.test.ts`
- Modify (regenerate): `examples/corpus.generated.ts`

**Interfaces:**
- Consumes: `CORPUS` (Task 2), `verifyAll` (Task 1).

Seed set (each is a proven language feature; `<category>/<id>`):
1. `basics/prelude-element` — a concept extending the prelude root + an instance.
2. `resolution/taxonomy-bare` — bare term resolution across a taxonomy.
3. `operators/operator-edges` — an author-defined operator materializing edges.
4. `operators/operator-value` — an operator value expression used on a RHS/array.
5. `objects/inline-objects` — an anonymous inline object literal.
6. `namespaces/qualified-resolution` — namespace-scoped resolution + a qualified name.
7. `references/type-directed` — value = edge vs. attribute by member type.
8. `bases/check-against` — multi-file: `base.todl` (marked in `manifest.bases`) + `main.todl` consuming it via `checkAgainst`.
9. `errors/missing-required` — INTENTIONAL error: a required member omitted (non-empty `diagnostics` golden), proving the harness captures failures.

- [ ] **Step 1: Author examples 1–9.** For each, create the folder, `example.json` (real `title`/`group`/`order`/`narrative`), and the `.todl` source(s). Use the concepts already proven in the repo's specs under `docs/superpowers/specs/` (e.g. `2026-08-16-operators-design.md`, `2026-08-15-inline-objects-design.md`, `2026-08-03-taxonomy-scoped-bare-resolution-design.md`, `2026-08-05-type-directed-references-design.md`, `2026-07-22-todl-check-against-design.md`) as authoritative syntax references. Set `expectClean: true` for 1–8 and `expectClean: false` for 9. Leave each `golden.json` as `{ "diagnostics": [], "document": { "nodes": [], "edges": [] } }` (Step 2 fills them).

- [ ] **Step 2: Generate goldens, then the corpus module**

```bash
npx tsx --conditions=development examples/tools/update-goldens.mts
node scripts/gen-corpus.mjs
```
Manually inspect each generated `golden.json`: examples 1–8 must have `"diagnostics": []`; example 9 must have a non-empty `diagnostics` array with the expected `cardinality.required-missing` code. If any clean example has diagnostics, fix the `.todl` source and regenerate. **This manual review is the gate that makes the goldens trustworthy** — never commit a golden you have not eyeballed.

- [ ] **Step 3: Write the regression test** `examples/tests/corpus.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CORPUS } from "../corpus.generated.js";
import { verifyAll } from "../../shared/verify.js";

test("every corpus example matches its committed golden", () => {
  const summary = verifyAll(CORPUS);
  const failures = summary.results.filter((r) => r.status === "fail");
  assert.equal(failures.length, 0,
    "corpus drift:\n" + failures.map((f) => `- ${f.id}\n${f.diff}`).join("\n"));
});

test("expectClean matches golden diagnostics", () => {
  for (const e of CORPUS) {
    const hasErrors = e.golden.diagnostics.some((d) => d.severity === "error");
    assert.equal(!hasErrors, e.manifest.expectClean, `${e.manifest.id}: expectClean mismatch`);
  }
});

test("corpus is non-empty and ids are unique", () => {
  assert.ok(CORPUS.length >= 9);
  assert.equal(new Set(CORPUS.map((e) => e.manifest.id)).size, CORPUS.length);
});
```

- [ ] **Step 4: Run the regression test**

Run: `npx tsx --conditions=development --test "examples/tests/corpus.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add examples/basics examples/resolution examples/operators examples/objects examples/namespaces examples/references examples/bases examples/errors examples/corpus.generated.ts examples/tests/corpus.test.ts
git commit -m "feat(demos): seed corpus (9 examples) + golden regression test"
```

---

## Task 4: `todl-demo` CLI

A thin node CLI over `shared/` + the node tooling: `list`, `run`, `test`.

**Files:**
- Create: `cli/package.json`, `cli/tsconfig.json`
- Create: `cli/src/main.ts`, `cli/src/commands/list.ts`, `cli/src/commands/run.ts`, `cli/src/commands/test.ts`, `cli/src/format.ts`
- Test: `cli/src/tests/commands.test.ts`

**Interfaces:**
- Consumes: `CORPUS`, `byId` (Task 2/3); `verifyAll` (Task 1); `updateGoldens` (Task 2).
- Produces: `runCommand(argv: string[]): number` (returns an exit code; `main.ts` calls `process.exit` with it).

- [ ] **Step 1: Write `cli/src/format.ts`**

```ts
// Minimal ANSI helpers + a stage header. No dependency — keeps the CLI lean.
const on = process.stdout.isTTY === true;
export const dim = (s: string) => (on ? `\x1b[2m${s}\x1b[0m` : s);
export const red = (s: string) => (on ? `\x1b[31m${s}\x1b[0m` : s);
export const green = (s: string) => (on ? `\x1b[32m${s}\x1b[0m` : s);
export const bold = (s: string) => (on ? `\x1b[1m${s}\x1b[0m` : s);
export const header = (title: string) => `\n${bold(`── ${title} ` + "─".repeat(Math.max(0, 40 - title.length)))}`;
```

- [ ] **Step 2: Write the failing CLI test** `cli/src/tests/commands.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "../main.js";

// Capture stdout for assertions.
function capture(fn: () => number): { code: number; out: string } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (s: string) => { chunks.push(s); return true; };
  try { const code = fn(); return { code, out: chunks.join("") }; }
  finally { (process.stdout as any).write = orig; }
}

test("list prints every example id", () => {
  const { code, out } = capture(() => runCommand(["list"]));
  assert.equal(code, 0);
  assert.match(out, /taxonomy-bare|prelude-element/);
});

test("run <id> prints diagnostics + emitted-json stages", () => {
  const { code, out } = capture(() => runCommand(["run", "errors/missing-required".split("/").pop()!]));
  assert.equal(code, 0);
  assert.match(out, /diagnostics/i);
});

test("run with unknown id exits non-zero", () => {
  const { code } = capture(() => runCommand(["run", "nope"]));
  assert.equal(code, 1);
});

test("test (no --update) passes against committed goldens", () => {
  const { code, out } = capture(() => runCommand(["test"]));
  assert.equal(code, 0);
  assert.match(out, /pass/i);
});
```

- [ ] **Step 3: Run and confirm FAIL** — module not found.

- [ ] **Step 4: Write the commands**

`cli/src/commands/list.ts`:
```ts
import { CORPUS } from "../../../examples/corpus.generated.js";
import { byGroup } from "../../../shared/corpus-access.js";
import { header, dim } from "../format.js";

export function list(): number {
  for (const [group, entries] of byGroup(CORPUS)) {
    process.stdout.write(header(group) + "\n");
    for (const e of entries) process.stdout.write(`  ${e.manifest.id}  ${dim(e.manifest.title)}\n`);
  }
  return 0;
}
```

`cli/src/commands/run.ts`:
```ts
import { CORPUS } from "../../../examples/corpus.generated.js";
import { byId } from "../../../shared/corpus-access.js";
import { verifyExample } from "../../../shared/verify.js";
import { header, red } from "../format.js";

export function run(id: string | undefined): number {
  if (!id) { process.stdout.write(red("usage: todl-demo run <id>\n")); return 1; }
  const entry = byId(CORPUS, id);
  if (!entry) { process.stdout.write(red(`unknown example: ${id}\n`)); return 1; }
  // The golden IS the normalized pipeline output — print it as the stages.
  const golden = verifyExample(entry, { update: true }).golden!;
  process.stdout.write(header("diagnostics") + "\n");
  if (golden.diagnostics.length === 0) process.stdout.write("  (none)\n");
  for (const d of golden.diagnostics) process.stdout.write(`  ${d.severity} ${d.code} ${d.message}\n`);
  process.stdout.write(header("emitted document (canonical)") + "\n");
  process.stdout.write(JSON.stringify(golden.document, null, 2) + "\n");
  return 0;
}
```

`cli/src/commands/test.ts`:
```ts
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CORPUS } from "../../../examples/corpus.generated.js";
import { verifyAll } from "../../../shared/verify.js";
import { updateGoldens } from "../../../examples/tools/update-goldens.mjs";
import { green, red } from "../format.js";

export function test(update: boolean): number {
  if (update) {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "examples");
    const s = updateGoldens(root);
    process.stdout.write(green(`updated ${s.updated} golden(s). Re-run 'npm run gen:corpus'.\n`));
    return 0;
  }
  const s = verifyAll(CORPUS);
  for (const r of s.results) {
    process.stdout.write(`${r.status === "pass" ? green("pass") : red("FAIL")}  ${r.id}\n`);
    if (r.diff) process.stdout.write(r.diff + "\n");
  }
  process.stdout.write(`\n${s.passed} passed, ${s.failed} failed\n`);
  return s.failed === 0 ? 0 : 1;
}
```

`cli/src/main.ts`:
```ts
import { list } from "./commands/list.js";
import { run } from "./commands/run.js";
import { test } from "./commands/test.js";

export function runCommand(argv: string[]): number {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "list": return list();
    case "run": return run(rest[0]);
    case "test": return test(rest.includes("--update"));
    default:
      process.stdout.write("usage: todl-demo <list|run <id>|test [--update]>\n");
      return cmd === undefined ? 1 : 1;
  }
}

// Direct invocation entry point.
if (process.argv[1] && /main\.(ts|js|mts|mjs)$/.test(process.argv[1])) {
  process.exit(runCommand(process.argv.slice(2)));
}
```

- [ ] **Step 5: Write `cli/package.json` and `cli/tsconfig.json`**

`cli/package.json`:
```json
{
  "name": "@pragmatic-tech-ai/todl-demo-cli",
  "private": true,
  "type": "module",
  "bin": { "todl-demo": "src/main.ts" },
  "description": "CLI demo/smoke tool for the todl example corpus (not published)."
}
```
`cli/tsconfig.json`:
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts", "../shared/**/*.ts", "../examples/**/*.ts"]
}
```

- [ ] **Step 6: Run the CLI tests**

Run: `npx tsx --conditions=development --test "cli/src/tests/commands.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 7: Smoke the CLI by hand**

```bash
npx tsx --conditions=development cli/src/main.ts list
npx tsx --conditions=development cli/src/main.ts run taxonomy-bare
npx tsx --conditions=development cli/src/main.ts test
```
Confirm `list` groups examples, `run` prints diagnostics + document, `test` prints all-pass and exits 0.

- [ ] **Step 8: Commit**

```bash
git add cli
git commit -m "feat(demos): todl-demo CLI (list/run/test) over the corpus"
```

---

## Task 5: Root wiring, scripts & docs

Wire npm scripts, confirm the package boundary, and document the workflow — the seam that makes the whole thing runnable and CI-ready.

**Files:**
- Modify: `package.json` (scripts only; do NOT touch `files`)
- Create: `examples/README.md`

- [ ] **Step 1: Add scripts to root `package.json`**

Add to `"scripts"` (keep existing entries):
```json
"gen:corpus": "node scripts/gen-corpus.mjs",
"gen:goldens": "tsx --conditions=development examples/tools/update-goldens.mts && npm run gen:corpus",
"test:corpus": "tsx --conditions=development --test \"shared/**/*.test.ts\" \"examples/**/*.test.ts\" \"cli/**/*.test.ts\"",
"cli": "tsx --conditions=development cli/src/main.ts"
```

- [ ] **Step 2: Verify the package boundary is intact**

Run: `npm pack --dry-run`
Expected: the printed file list contains ONLY `dist/**` and `README.md` (per the existing `files` array). Confirm `examples/`, `shared/`, `cli/`, `scripts/gen-corpus.mjs` are ABSENT. If any appear, they were wrongly added to `files` — revert.

- [ ] **Step 3: Confirm the full corpus test suite is green**

Run: `npm run test:corpus`
Expected: PASS — verify (6) + corpus-access (4) + load-from-disk (1+) + corpus regression (3) + CLI (4).

- [ ] **Step 4: Confirm the existing suite still passes (no regressions)**

Run: `npm test`
Expected: PASS — the pre-existing `src/**` suite, untouched by this work.

- [ ] **Step 5: Write `examples/README.md`**

Document: the corpus folder shape (`example.json`/`*.todl`/`golden.json`); that goldens are generated, never hand-edited; the workflow (`npm run gen:goldens` after changing an example, then eyeball the diff before committing); that `shared/` is browser-safe and Phase 2 (the Mural app) will consume the same `CORPUS` + `verify`; and the determinism rule (ids are canonicalized in `normalize`).

- [ ] **Step 6: Commit**

```bash
git add package.json examples/README.md
git commit -m "chore(demos): wire gen/test/cli scripts + document corpus workflow"
```

---

## Self-Review

**Spec coverage:**
- Use case 2 (corpus + runner + golden regression) → Tasks 1–3. ✓
- Use case 3 (CLI) → Task 4. ✓
- One-corpus-source-of-truth + generated module → Task 2 (`gen-corpus.mjs`, `corpus.generated.ts`). ✓
- `shared/` pure seam → Tasks 1–2, enforced by Global Constraints + Task 5 boundary check. ✓
- Golden snapshots + `--update` → Task 1 (`update` path) + Task 2 (`update-goldens.mts`) + Task 4 (`test --update`). ✓
- Determinism (seeded id-gen + canonical) → Task 1 `normalize`/`canonicalizeIds`, strengthened to full id remap after the prelude-id finding. ✓
- Packaging boundary (not in `files`) → Task 5 Step 2. ✓
- Separate `test:corpus` script (outside `src/**`) → Task 5 Step 1. ✓
- Multi-file / `checkAgainst` example → Task 3 example 8. ✓
- Intentional-error example → Task 3 example 9. ✓
- Phase 2 (Mural app) and Phase 3 (graph view, docs export) → OUT OF SCOPE for this plan, by design. ✓

**Placeholder scan:** The only intentional placeholder is the `requireTodl` indirection in Task 1 Step 4, explicitly flagged and removed in Step 5 — it exists to make the `toJSON` dependency of the bases path impossible to miss. No `TBD`/`add error handling`/vague steps remain.

**Type consistency:** `CorpusEntry`, `Golden`, `VerifyResult`, `VerifySummary` are defined once (Task 1) and consumed by name everywhere. `verifyExample`/`verifyAll`/`byId`/`byGroup`/`groups`/`loadExamplesFromDisk`/`updateGoldens`/`runCommand` signatures match across the Interfaces blocks and their call sites. `normalize` returns `Golden`; `run`/`test --update` both source their output from `verifyExample(entry, {update:true}).golden!`, so CLI output and asserted golden are the same shape.

**Open implementer risks:**
- `checkAgainst` bases path is exercised only by example 8; verify its golden by hand in Task 3 Step 2 with extra care.
