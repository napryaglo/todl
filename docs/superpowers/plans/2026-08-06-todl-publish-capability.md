# TODL Publish Capability + Package Stores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the reusable *compile → derive → persist* publish spine out of the Plexus project factories into TODL core (`compilePackage` + `publish` + a `PackageStore` family), then have both Plexus factories delegate to it.

**Architecture:** TODL gains a pure `compilePackage` (compile against bases, gate on errors, `toJSON`, derive the palette class list) and a `publish` orchestrator that persists a `CompiledPackage` through an injected `PackageStore` — `BlobPackageStore` (today's `model.json` + `src/` layout) now, a fake-tested `GraphPackageStore` for the graph family. TODL stays I/O-free (persistence via injected `PackageSink`/`GraphStore` seams). Plexus adapts `IStorage` to `PackageSink` and delegates.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node built-in test runner (`node:test` + `node:assert/strict`) for TODL; Vitest for Plexus. `@pragmatic-tech-ai/todl` published to Verdaccio.

**Spec:** `docs/superpowers/specs/2026-08-06-todl-publish-capability-design.md`.

## Global Constraints

- **Registry:** Verdaccio at `http://localhost:4873/` (TODL `publishConfig` + `.npmrc` already point here).
- **TODL tsconfig:** `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are ON — index access yields `T | undefined`; do not pass `undefined` to an optional property, omit it.
- **Tests live in a `tests/` subfolder** next to the code they exercise, in every project (TODL and Plexus).
- **Real enums, never string-literal unions.** Reuse TODL's existing enums (`Severity`, `Tier`, `MetaKind`, `EdgeKind`). Note `toJSON` emits enum members **by name string** in the `TodlDocument` (so `node.tier === 'Instance'`, `edge.kind === 'Annotated'` compare against the member-name string — this is existing behaviour, keep it).
- **`SourceFile` is `{ uri: string; text: string }`** — never `{ path, content }`.
- **Commit messages end with:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit/push only when the human asks.
- **TODL commands:** test `npx tsx --conditions=development --test "src/**/*.test.ts"`; typecheck `npm run typecheck`; build `npm run build`.
- **Plexus commands:** test `npx vitest run`; `.mu` compile `npm run compile:mu`.

## File Structure

TODL (new `src/publish/`):
- `src/publish/reflect.ts` — `PublishedClass`, `deriveClasses`, `projectAnnotations` (relocated model/annotation reflection; pure).
- `src/publish/publish.ts` — `PackageIdentity`, `CompiledPackage`, `CompileOutcome`, `PublishOutcome`, `compilePackage`, `publish`.
- `src/publish/stores.ts` — `PackageStore`, `PackageSink`, `BlobPackageStore`, `GraphPackageStore`.
- `src/publish/tests/*.test.ts` — one test file per unit.
- `src/index.ts` — add exports.
- `package.json` — version bump.

Plexus:
- `src/renderer/src/services/storage/storage-package-sink.ts` — `IStorage` → `PackageSink` adapter.
- `library-project-factory.ts`, `meta-model-project-factory.ts` — delegate.
- `library/services/library-bundle.ts` — drop local `deriveClasses`, re-export from todl.
- `package.json` — bump `@pragmatic-tech-ai/todl`.

---

### Task 1: Relocate reflection into TODL (`src/publish/reflect.ts`)

**Files:**
- Create: `src/publish/reflect.ts`
- Test: `src/publish/tests/reflect.test.ts`

**Interfaces:**
- Consumes: `TodlDocument`, `JsonNode` from `../emit/json.js`.
- Produces: `interface PublishedClass { id: string; concept: string; localId?: string; label?: string; icon?: string }`; `function deriveClasses(model: TodlDocument): PublishedClass[]`; `function projectAnnotations(model: TodlDocument, targetId: string): Record<string, Record<string, unknown>>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/publish/tests/reflect.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TodlDocument } from "../../emit/json.js";
import { deriveClasses, projectAnnotations } from "../reflect.js";

// A compiled doc with one clabject `az` (class=true) carrying a label and an
// `icon` annotation application `az@icon { path = "resources/az.svg" }`.
function doc(): TodlDocument {
  return {
    nodes: [
      { id: "ms.az", tier: "Instance", typeOf: "location", attrs: { id: "az", class: true, label: "Azure" } },
      { id: "ms.az@icon", tier: "Instance", typeOf: "icon", attrs: { path: "resources/az.svg", namespace: "ms" } },
      { id: "ms.other", tier: "Ontology", typeOf: "concept", attrs: { id: "other" } },
    ],
    edges: [{ kind: "Annotated", via: null, from: "ms.az", to: "ms.az@icon" }],
  };
}

test("projectAnnotations keys applications by annotation name, strips namespace", () => {
  assert.deepEqual(projectAnnotations(doc(), "ms.az"), { icon: { path: "resources/az.svg" } });
  assert.deepEqual(projectAnnotations(doc(), "ms.missing"), {});
});

test("deriveClasses returns only class=true Instance clabjects with label + annotation icon", () => {
  assert.deepEqual(deriveClasses(doc()), [
    { id: "ms.az", concept: "location", localId: "az", label: "Azure", icon: "resources/az.svg" },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/publish/tests/reflect.test.ts"`
Expected: FAIL — cannot find `../reflect.js`.

- [ ] **Step 3: Write minimal implementation**

Port verbatim from Plexus `annotation-projection.ts` + `library-bundle.ts` (`deriveClasses`), adapting imports to TODL:

```ts
// src/publish/reflect.ts
import type { TodlDocument } from "../emit/json.js";

const ANNOTATED = "Annotated";
const NAMESPACE_ATTR = "namespace";

export interface PublishedClass {
  id: string;
  concept: string;
  localId?: string;
  label?: string;
  icon?: string;
}

/** Project a target node's annotations from a compiled document: walk `Annotated`
 *  edges out of `targetId`, key each application by its `typeOf`, value = its
 *  scalar attrs minus the `namespace` provenance stamp. Pure; no I/O. */
export function projectAnnotations(model: TodlDocument, targetId: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const edge of model.edges) {
    if (edge.kind !== ANNOTATED || edge.from !== targetId) continue;
    const appNode = model.nodes.find((n) => n.id === edge.to);
    if (appNode === undefined) continue;
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(appNode.attrs as Record<string, unknown>)) {
      if (k === NAMESPACE_ATTR) continue;
      params[k] = v;
    }
    out[appNode.typeOf] = params;
  }
  return out;
}

/** The instantiable classes a package provides: Instance-tier clabjects
 *  (`attrs.class === true`), with label + annotation-derived icon. */
export function deriveClasses(model: TodlDocument): PublishedClass[] {
  const out: PublishedClass[] = [];
  for (const n of model.nodes) {
    if (n.tier !== "Instance" || (n.attrs as Record<string, unknown>).class !== true) continue;
    const attrs = n.attrs as Record<string, unknown>;
    const cls: PublishedClass = { id: n.id, concept: n.typeOf };
    if (typeof attrs.id === "string") cls.localId = attrs.id;
    if (typeof attrs.label === "string") cls.label = attrs.label;
    const iconAnn = projectAnnotations(model, n.id).icon;
    const iconPath = iconAnn === undefined ? undefined : iconAnn.path;
    if (typeof iconPath === "string") cls.icon = iconPath;
    out.push(cls);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/publish/tests/reflect.test.ts"`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/publish/reflect.ts src/publish/tests/reflect.test.ts
git commit -m "feat(publish): relocate deriveClasses + projectAnnotations reflection into TODL"
```

---

### Task 2: `compilePackage` + package types (`src/publish/publish.ts`)

**Files:**
- Create: `src/publish/publish.ts`
- Test: `src/publish/tests/compile-package.test.ts`

**Interfaces:**
- Consumes: `checkAgainst` from `../api.js`; `toJSON`, `TodlDocument` from `../emit/json.js`; `Severity`, `Diagnostic` from `../diagnostics/diagnostic.js`; `SourceFile` from `../diagnostics/span.js`; `deriveClasses`, `PublishedClass` from `./reflect.js`.
- Produces:
  - `interface PackageIdentity { id: string; version: string; name?: string }`
  - `interface CompiledPackage extends PackageIdentity { document: TodlDocument; sources: readonly SourceFile[]; classes: readonly PublishedClass[] }`
  - `interface CompileOutcome { ok: boolean; diagnostics: readonly Diagnostic[]; errors: readonly Diagnostic[]; package?: CompiledPackage }`
  - `function compilePackage(bases: readonly TodlDocument[], sources: readonly SourceFile[], identity: PackageIdentity): CompileOutcome`

- [ ] **Step 1: Write the failing test**

```ts
// src/publish/tests/compile-package.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { compilePackage } from "../publish.js";

const META = `namespace ea {
  concept technology { label : string; }
}`;

test("compilePackage: clean sources → ok, document + classes derived", () => {
  const out = compilePackage([], [{ uri: "ea.todl", text: META }], { id: "ea", version: "0.1.0" });
  assert.equal(out.ok, true);
  assert.equal(out.errors.length, 0);
  assert.ok(out.package);
  // document equals the direct compile
  assert.deepEqual(out.package!.document, toJSON(check([{ uri: "ea.todl", text: META }]).model));
  assert.equal(out.package!.id, "ea");
  assert.equal(out.package!.version, "0.1.0");
});

test("compilePackage: erroring sources → not ok, errors populated, no package", () => {
  const bad = `namespace x { concept c { f : nonexistent-type; } }`;
  const out = compilePackage([], [{ uri: "x.todl", text: bad }], { id: "x", version: "0.1.0" });
  assert.equal(out.ok, false);
  assert.ok(out.errors.length > 0);
  assert.equal(out.package, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/publish/tests/compile-package.test.ts"`
Expected: FAIL — cannot find `../publish.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/publish/publish.ts
import { checkAgainst } from "../api.js";
import { toJSON, type TodlDocument } from "../emit/json.js";
import { Severity, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/span.js";
import { deriveClasses, type PublishedClass } from "./reflect.js";

export interface PackageIdentity { id: string; version: string; name?: string }

export interface CompiledPackage extends PackageIdentity {
  document: TodlDocument;
  sources: readonly SourceFile[];
  classes: readonly PublishedClass[];
}

export interface CompileOutcome {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[];
  package?: CompiledPackage;
}

/** Compile sources against bases, gate on errors, and — if clean — build a
 *  self-describing CompiledPackage. Pure; no I/O. */
export function compilePackage(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  identity: PackageIdentity,
): CompileOutcome {
  const { model, diagnostics } = checkAgainst([...bases], [...sources]);
  const errors = diagnostics.filter((d) => d.severity === Severity.Error);
  if (errors.length > 0) return { ok: false, diagnostics, errors };
  const document = toJSON(model);
  const pkg: CompiledPackage = {
    ...identity,
    document,
    sources,
    classes: deriveClasses(document),
  };
  return { ok: true, diagnostics, errors, package: pkg };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/publish/tests/compile-package.test.ts"`
Expected: PASS. (If `check([])` vs `checkAgainst([], …)` differ, the first test's `deepEqual` reveals it — both inject the prelude; they must match.)

- [ ] **Step 5: Commit**

```bash
git add src/publish/publish.ts src/publish/tests/compile-package.test.ts
git commit -m "feat(publish): compilePackage — compile + gate + derive, pure"
```

---

### Task 3: `PackageStore`/`PackageSink` + `BlobPackageStore` (`src/publish/stores.ts`)

**Files:**
- Create: `src/publish/stores.ts`
- Test: `src/publish/tests/blob-store.test.ts`

**Interfaces:**
- Consumes: `CompiledPackage` from `./publish.js`.
- Produces:
  - `interface PackageStore { persist(pkg: CompiledPackage): Promise<void> }`
  - `interface PackageSink { writeText(path: string, content: string): Promise<void>; writeBytes?(path: string, bytes: Uint8Array): Promise<void> }`
  - `class BlobPackageStore implements PackageStore { constructor(sink: PackageSink, opts?: { layout?: (id: string, version: string) => string }) }`

- [ ] **Step 1: Write the failing test**

```ts
// src/publish/tests/blob-store.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompiledPackage } from "../publish.js";
import { BlobPackageStore, type PackageSink } from "../stores.js";

function fakeSink() {
  const files = new Map<string, string>();
  const sink: PackageSink = { writeText: async (p, c) => void files.set(p, c) };
  return { sink, files };
}

function pkg(): CompiledPackage {
  return {
    id: "ms", version: "1.0.0",
    document: { nodes: [{ id: "ms.a", tier: "Instance", typeOf: "t", attrs: { id: "a" } }], edges: [] },
    sources: [{ uri: "ms.todl", text: "namespace ms {}" }],
    classes: [],
  };
}

test("BlobPackageStore writes model.json + src/<uri> under <id>/<version>", async () => {
  const { sink, files } = fakeSink();
  await new BlobPackageStore(sink).persist(pkg());
  assert.deepEqual(JSON.parse(files.get("ms/1.0.0/model.json")!), pkg().document);
  assert.equal(files.get("ms/1.0.0/src/ms.todl"), "namespace ms {}");
});

test("BlobPackageStore honours a custom layout", async () => {
  const { sink, files } = fakeSink();
  await new BlobPackageStore(sink, { layout: (id, v) => `packages/${id}@${v}` }).persist(pkg());
  assert.ok(files.has("packages/ms@1.0.0/model.json"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/publish/tests/blob-store.test.ts"`
Expected: FAIL — cannot find `../stores.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/publish/stores.ts
import type { CompiledPackage } from "./publish.js";

export interface PackageStore {
  persist(pkg: CompiledPackage): Promise<void>;
}

export interface PackageSink {
  writeText(path: string, content: string): Promise<void>;
  writeBytes?(path: string, bytes: Uint8Array): Promise<void>;
}

const defaultLayout = (id: string, version: string): string => `${id}/${version}`;

/** Persist a package as blobs: <base>/model.json + <base>/src/<uri>. Reproduces
 *  the on-disk layout Plexus publishes today. */
export class BlobPackageStore implements PackageStore {
  private readonly layout: (id: string, version: string) => string;
  constructor(private readonly sink: PackageSink, opts?: { layout?: (id: string, version: string) => string }) {
    this.layout = opts?.layout ?? defaultLayout;
  }
  async persist(pkg: CompiledPackage): Promise<void> {
    const base = this.layout(pkg.id, pkg.version);
    await this.sink.writeText(`${base}/model.json`, JSON.stringify(pkg.document, null, 2));
    for (const s of pkg.sources) await this.sink.writeText(`${base}/src/${s.uri}`, s.text);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/publish/tests/blob-store.test.ts"`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/publish/stores.ts src/publish/tests/blob-store.test.ts
git commit -m "feat(publish): PackageStore/PackageSink seam + BlobPackageStore"
```

---

### Task 4: `GraphPackageStore` (extend `src/publish/stores.ts`)

**Files:**
- Modify: `src/publish/stores.ts`
- Test: `src/publish/tests/graph-store.test.ts`

**Interfaces:**
- Consumes: `graphFromJSON` from `../emit/json.js`; `GraphStore`, `InMemoryGraphStore` from `../model/graph-store.js`.
- Produces: `class GraphPackageStore implements PackageStore { constructor(store: GraphStore) }`.

**Note:** Reconstruct the compiled graph from `pkg.document` via `graphFromJSON`, then copy its nodes/edges into the target `GraphStore` (use the store's own `addNode`/`addEdge`/`setAttr` API — inspect `GraphStore` in `src/model/graph-store.ts` for exact signatures and mirror how `graphFromJSON` builds a `Graph`). This proves the seam generalizes to the Cypher/Dgraph family; no live DB needed (test over `InMemoryGraphStore`).

- [ ] **Step 1: Write the failing test**

```ts
// src/publish/tests/graph-store.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryGraphStore } from "../../model/graph-store.js";
import type { CompiledPackage } from "../publish.js";
import { GraphPackageStore } from "../stores.js";

function pkg(): CompiledPackage {
  return {
    id: "ms", version: "1.0.0",
    document: {
      nodes: [
        { id: "ms.a", tier: "Instance", typeOf: "t", attrs: { id: "a", label: "A" } },
        { id: "ms.b", tier: "Instance", typeOf: "t", attrs: { id: "b" } },
      ],
      edges: [{ kind: "Relationship", via: "rel", from: "ms.a", to: "ms.b" }],
    },
    sources: [],
    classes: [],
  };
}

test("GraphPackageStore loads every compiled node + edge into the GraphStore", async () => {
  const store = new InMemoryGraphStore();
  await new GraphPackageStore(store).persist(pkg());
  assert.equal(store.nodeCount(), 2);
  assert.ok(store.hasNode("ms.a"));
  assert.equal(store.getNode("ms.a")?.attrs.get("label"), "A");
  assert.equal(store.outEdges("ms.a").length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/publish/tests/graph-store.test.ts"`
Expected: FAIL — `GraphPackageStore` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/publish/stores.ts` (adjust to the real `GraphStore` API discovered in `graph-store.ts`):

```ts
import { graphFromJSON } from "../emit/json.js";
import type { GraphStore } from "../model/graph-store.js";

/** Persist a package's compiled graph into a GraphStore (the Cypher/Dgraph
 *  sibling of BlobPackageStore). Sources are not written — the graph IS the store. */
export class GraphPackageStore implements PackageStore {
  constructor(private readonly store: GraphStore) {}
  async persist(pkg: CompiledPackage): Promise<void> {
    const graph = graphFromJSON(pkg.document);
    for (const node of graph.allNodes()) {
      this.store.addNode(node.id, node.tier, node.typeOf);
      for (const [k, v] of node.attrs) this.store.setAttr(node.id, k, v);
      for (const e of graph.outEdges(node.id)) this.store.addEdge(e);
    }
    this.store.commit();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/publish/tests/graph-store.test.ts"`
Expected: PASS. If the `GraphStore`/`Graph` traversal API differs, adapt the loop to the real signatures (the test asserts behaviour, not the internal calls).

- [ ] **Step 5: Commit**

```bash
git add src/publish/stores.ts src/publish/tests/graph-store.test.ts
git commit -m "feat(publish): GraphPackageStore over the GraphStore seam (fake-tested)"
```

---

### Task 5: `publish` orchestrator (extend `src/publish/publish.ts`)

**Files:**
- Modify: `src/publish/publish.ts`
- Test: `src/publish/tests/publish.test.ts`

**Interfaces:**
- Consumes: `PackageStore` from `./stores.js`; the Task 2 types.
- Produces:
  - `interface PublishOutcome extends CompileOutcome { persisted: boolean }`
  - `function publish(bases, sources, store: PackageStore, identity: PackageIdentity): Promise<PublishOutcome>`

- [ ] **Step 1: Write the failing test**

```ts
// src/publish/tests/publish.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompiledPackage } from "../publish.js";
import { publish } from "../publish.js";
import type { PackageStore } from "../stores.js";

function spyStore() {
  const seen: CompiledPackage[] = [];
  const store: PackageStore = { persist: async (p) => void seen.push(p) };
  return { store, seen };
}

const GOOD = `namespace ea { concept technology { label : string; } }`;
const BAD = `namespace x { concept c { f : nonexistent-type; } }`;

test("publish persists on a clean compile", async () => {
  const { store, seen } = spyStore();
  const out = await publish([], [{ uri: "ea.todl", text: GOOD }], store, { id: "ea", version: "0.1.0" });
  assert.equal(out.ok, true);
  assert.equal(out.persisted, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.id, "ea");
});

test("publish does NOT persist a failing compile", async () => {
  const { store, seen } = spyStore();
  const out = await publish([], [{ uri: "x.todl", text: BAD }], store, { id: "x", version: "0.1.0" });
  assert.equal(out.ok, false);
  assert.equal(out.persisted, false);
  assert.equal(seen.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/publish/tests/publish.test.ts"`
Expected: FAIL — `publish` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/publish/publish.ts`:

```ts
import type { PackageStore } from "./stores.js";

export interface PublishOutcome extends CompileOutcome { persisted: boolean }

/** Compile, and — only if clean — persist the package through the store. */
export async function publish(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  store: PackageStore,
  identity: PackageIdentity,
): Promise<PublishOutcome> {
  const outcome = compilePackage(bases, sources, identity);
  if (!outcome.ok || outcome.package === undefined) return { ...outcome, persisted: false };
  await store.persist(outcome.package);
  return { ...outcome, persisted: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/publish/tests/publish.test.ts"`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/publish/publish.ts src/publish/tests/publish.test.ts
git commit -m "feat(publish): publish orchestrator — persist only a clean compile"
```

---

### Task 6: Export + bump + build + publish `0.16.0`

**Files:**
- Modify: `src/index.ts`, `package.json`

**Interfaces:**
- Produces (public API): `compilePackage`, `publish`, `PackageIdentity`, `CompiledPackage`, `CompileOutcome`, `PublishOutcome`, `PackageStore`, `PackageSink`, `BlobPackageStore`, `GraphPackageStore`, `deriveClasses`, `projectAnnotations`, `PublishedClass`.

- [ ] **Step 1: Add exports to `src/index.ts`**

```ts
export {
  compilePackage,
  publish,
  type PackageIdentity,
  type CompiledPackage,
  type CompileOutcome,
  type PublishOutcome,
} from "./publish/publish.js";
export {
  BlobPackageStore,
  GraphPackageStore,
  type PackageStore,
  type PackageSink,
} from "./publish/stores.js";
export { deriveClasses, projectAnnotations, type PublishedClass } from "./publish/reflect.js";
```

- [ ] **Step 2: Full test suite + typecheck + build**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck` then `npm run build`.
Expected: all green; `dist/publish/{reflect,publish,stores}.js` exist; `dist/index.js` exports `compilePackage`/`publish`/`BlobPackageStore`.

- [ ] **Step 3: Bump version**

Run: `npm version minor --no-git-tag-version` (0.15.0 → 0.16.0).

- [ ] **Step 4: Publish to Verdaccio**

Run: `npm publish`. (Registry is Verdaccio via `.npmrc`/`publishConfig`; `prepublishOnly` re-runs clean+build.)
Verify: `npm view @pragmatic-tech-ai/todl version --registry http://localhost:4873` → `0.16.0`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts package.json
git commit -m "feat(publish): export publish capability; release 0.16.0"
```

---

### Task 7: Plexus — bump dependency to `^0.16.0`

**Files:**
- Modify: `Plexus/package.json` (+ `package-lock.json`)

- [ ] **Step 1: Install the new version**

Run (in `Plexus/`): `npm install @pragmatic-tech-ai/todl@^0.16.0 --registry http://localhost:4873`.

- [ ] **Step 2: Verify exports present**

Run: `grep -o "compilePackage\|BlobPackageStore\|publish" node_modules/@pragmatic-tech-ai/todl/dist/index.js | sort -u`
Expected: shows `BlobPackageStore`, `compilePackage`, `publish`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump @pragmatic-tech-ai/todl to ^0.16.0"
```

---

### Task 8: Plexus — `StoragePackageSink` + delegate the **library** factory

**Files:**
- Create: `Plexus/src/renderer/src/services/storage/storage-package-sink.ts`
- Create: `Plexus/src/renderer/src/services/storage/tests/storage-package-sink.test.ts`
- Modify: `library/services/library-project-factory.ts`, `library/services/library-bundle.ts`

**Interfaces:**
- Consumes: `IStorage` from `../storage.js`; `PackageSink` from `@pragmatic-tech-ai/todl`.
- Produces: `class StoragePackageSink implements PackageSink { constructor(storage: IStorage) }`.

- [ ] **Step 1: Write the failing adapter test**

```ts
// storage-package-sink.test.ts
import { test, expect } from 'vitest'
import { StoragePackageSink } from '../storage-package-sink.js'

function fakeStorage() {
  const files = new Map<string, string>()
  return {
    Root: '/', files,
    WriteText: async (p: string, c: string) => void files.set(p, c),
    WriteBytes: async (p: string, b: Uint8Array) => void files.set(p, `bytes:${b.length}`),
  } as unknown as import('../storage.js').IStorage & { files: Map<string, string> }
}

test('StoragePackageSink forwards writeText/writeBytes to IStorage', async () => {
  const s = fakeStorage()
  const sink = new StoragePackageSink(s)
  await sink.writeText('a/model.json', '{}')
  await sink.writeBytes!('a/x.bin', new Uint8Array([1, 2, 3]))
  expect(s.files.get('a/model.json')).toBe('{}')
  expect(s.files.get('a/x.bin')).toBe('bytes:3')
})
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run src/renderer/src/services/storage/tests/storage-package-sink.test.ts` (cannot find module).

- [ ] **Step 3: Implement the adapter**

```ts
// storage-package-sink.ts
import type { PackageSink } from '@pragmatic-tech-ai/todl'
import type { IStorage } from './storage.js'

/** Adapts the project IStorage to TODL's PackageSink so publish can write a
 *  bundle's model.json + src/ through it. */
export class StoragePackageSink implements PackageSink {
  constructor(private readonly storage: IStorage) {}
  writeText(path: string, content: string): Promise<void> { return this.storage.WriteText(path, content) }
  writeBytes(path: string, bytes: Uint8Array): Promise<void> { return this.storage.WriteBytes(path, bytes) }
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Delegate `library-bundle.ts` reflection**

Delete the local `deriveClasses` body and `PublishedClass` interface; re-export from todl so existing importers are unaffected:

```ts
export { deriveClasses, type PublishedClass } from '@pragmatic-tech-ai/todl'
```

Keep `scanResources`, `LibraryBundleManifest`, and the local `projectAnnotations` consumers as-is.

- [ ] **Step 6: Delegate the factory's compile + publish**

In `library-project-factory.ts`:
- `compileToDocument`: replace the inline `checkAgainst` + filter with `compilePackage(bases, sources, { id, version })`, returning `{ doc: outcome.package?.document ?? emptyDoc, problems: outcome.errors.map(d => d.message) }` (preserve the existing return shape/`problems` strings).
- `publish`: build `new BlobPackageStore(new StoragePackageSink(dest))`, call `await publish(bases, sources, store, { id: manifest.id, version: manifest.libVersion, name: manifest.name })`; on `!persisted` surface `outcome.errors` as today; replace the manual `dest.WriteText(model.json)` + `src/` loop (now done by the store). Derive `classes` from `outcome.package!.classes` for the `library.json` bundle. Keep `scanResources`, presentation baking, resource copying unchanged.

- [ ] **Step 7: Run the library test suites**

Run: `npx vitest run src/renderer/src/modules/library`
Expected: PASS (factory + `library-bundle` tests green against the delegated path).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/services/storage src/renderer/src/modules/library
git commit -m "refactor(library): delegate publish to TODL compilePackage + BlobPackageStore"
```

---

### Task 9: Plexus — delegate the **meta-model** factory

**Files:**
- Modify: `meta-model/services/meta-model-project-factory.ts`

**Interfaces:**
- Consumes: `compilePackage`, `publish`, `BlobPackageStore` from `@pragmatic-tech-ai/todl`; `StoragePackageSink` (Task 8); local `projectAnnotations` for manifest annotations.

- [ ] **Step 1: Delegate `compileToDocument`** — same pattern as Task 8 (`compilePackage(bases, sources, { id, version })`, preserve `{ doc, problems }`).

- [ ] **Step 2: Delegate `publish`** — `new BlobPackageStore(new StoragePackageSink(dest))`, `await publish(...)`; the store writes `model.json` + `src/`. Build `manifest.json` (`MetaModelManifestFile`) as today, computing its annotations via the local `projectAnnotations(outcome.package!.document, <packageTargetId>)`. Keep presentation baking unchanged.

- [ ] **Step 3: Run the meta-model suites**

Run: `npx vitest run src/renderer/src/modules/meta-model`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/modules/meta-model
git commit -m "refactor(meta-model): delegate publish to TODL compilePackage + BlobPackageStore"
```

---

### Task 10: Plexus — full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Compile `.mu` (unchanged, sanity)** — `npm run compile:mu` → `compiled N files`.

- [ ] **Step 2: Full suite** — `npx vitest run` → all green (baseline was 554 passed, 2 skipped; expect the same or +/- the adapter test).

- [ ] **Step 3: Report** — confirm no `deriveClasses` remains defined in Plexus (`grep -rn "function deriveClasses" src` → none; only the re-export). Confirm both factories no longer write `model.json` directly (`grep -n "model.json" library/... meta-model/...` → only reads, if any).

---

## Notes for the executor

- **Do the TODL tasks (1–6) first and publish `0.16.0` before any Plexus task** — Plexus cannot import the new symbols until the tarball is on Verdaccio.
- **Preserve public return shapes on the Plexus side.** `compileToDocument` returns `{ doc, problems }` consumed by `WorkspaceBaseResolver`; the factory `publish` returns a Plexus `PublishResult` with a user-facing message. Only the *internals* delegate — the signatures Plexus exposes do not change.
- **`exactOptionalPropertyTypes`:** in `deriveClasses`/`compilePackage`, build optional fields by conditional assignment (as shown), never by assigning a possibly-`undefined` value to an optional property.
