# Own-Content-Only Published Packages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A published meta-model or library `model.json` contains only its own compiled nodes/edges, records its base dependencies, and consumers resolve those bases transitively.

**Architecture:** Two halves. TODL: `compilePackage` emits an own-provenance-filtered `model.json` (via a new `toJSONOwn`) carrying a `dependencies: PackageRef[]` field, and retains the full closure as `fullDocument` for annotation enrichment. Plexus: `resolveBases` walks each package's recorded `dependencies` transitively (dedup + cycle guard), and the meta-model/library publishers record their bound bases. Ship the (backward-compatible) transitive resolver first, then republish the corpus own-only.

**Tech Stack:** TypeScript (ESM, strict). TODL tests: `tsx --conditions=development --test "src/**/*.test.ts"`. Plexus tests: `vitest run`. Local registry: Verdaccio `http://localhost:4873`.

**Spec:** `TODL/docs/superpowers/specs/2026-08-21-own-content-packages-design.md`

## Global Constraints

- Publish `@pragmatic-lab/todl` ONLY to Verdaccio `http://localhost:4873`, never public npm.
- Commit / push / publish ONLY when the user asks; if on the default branch, branch first.
- Every test file lives in a `tests/` subfolder next to its source (TODL `src/x/tests/*.test.ts`, Plexus `src/**/tests/*.test.ts`).
- A fixed set of named string values is a real TypeScript `enum`, never a string-literal union — `PackageKind` is an enum with explicit string values.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Version pinning is EXACT (`id@version`); the dependency-resolution model is TRANSITIVE.
- `TodlDocument` stays `{ nodes, edges }`; `PackageDocument` is a superset adding optional `dependencies`. `graphFromJSON` and the `bases: TodlDocument[]` input path must remain unaffected.

---

## File Structure

**TODL**
- `src/emit/json.ts` — add `toJSONOwn(model, ownIds)`; export it.
- `src/publish/reflect.ts` — `deriveClasses` gains optional `annotationsFrom?: TodlDocument`.
- `src/publish/publish.ts` — `PackageKind`, `PackageRef`, `PackageDocument`; new `compilePackage`/`publish` signatures; own-only emit + `fullDocument` + `dependencies`; `CompiledPackage.fullDocument`.
- `src/index.ts` — export `PackageKind`, `PackageRef`, `PackageDocument`, `toJSONOwn`.
- `src/emit/tests/to-json-own.test.ts`, `src/publish/tests/compile-package.test.ts` (extend), `src/publish/tests/reflect.test.ts` (extend).

**Plexus**
- `package.json` — bump `@pragmatic-lab/todl`.
- `src/renderer/src/services/projects/base-resolver.ts` — transitive walk.
- `src/renderer/src/modules/library/services/library-project-factory.ts` — record deps, pass own doc to presentation.
- `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts` — record deps.
- `src/renderer/src/services/projects/tests/base-resolver.test.ts` (new), plus factory test updates.

---

### Task 1: TODL — `toJSONOwn` provenance-filtered emitter

**Files:**
- Modify: `TODL/src/emit/json.ts`
- Modify: `TODL/src/index.ts`
- Test: `TODL/src/emit/tests/to-json-own.test.ts`

**Interfaces:**
- Consumes: `Repository` (`allNodes()`, `outEdges(id)`), `NodeId`, existing `toJSON`, `TodlDocument`.
- Produces: `export function toJSONOwn(model: Repository, ownIds: ReadonlySet<NodeId>): TodlDocument` — emits node `N` iff `N ∈ ownIds`, and every out-edge of each such node (edges to base ids kept as dangling references).

- [ ] **Step 1: Write the failing test**

```ts
// TODL/src/emit/tests/to-json-own.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check, checkAgainst } from '../../api.js';
import { toJSON, toJSONOwn } from '../json.js';

describe('toJSONOwn', () => {
  test('emits only own nodes + their out-edges, dropping base + prelude nodes', () => {
    // A base meta-model providing `widget`.
    const base = toJSON(check([{ uri: 'm.todl', text: 'concept widget;' }]).model);
    // Own library declares a class of widget → an own node whose typeOf is the base id.
    const { model, provenance } = checkAgainst([base], [
      { uri: 'l.todl', text: 'widget Button { class = true; }' },
    ]);
    const ownIds = new Set(provenance.keys());
    const own = toJSONOwn(model, ownIds);

    const ids = new Set(own.nodes.map((n) => n.id));
    assert.ok(ids.has('Button'), 'own class node present');
    assert.ok(!ids.has('widget'), 'base node excluded');
    assert.ok(![...ids].some((id) => id === 'element' || id === 'string'),
      'prelude nodes excluded');
    // Every emitted edge originates from an own node.
    for (const e of own.edges) assert.ok(ownIds.has(e.from), `edge from own node: ${e.from}`);
    // The InstanceOf/typeOf reference to the base id is preserved (dangling).
    const btn = own.nodes.find((n) => n.id === 'Button');
    assert.equal(btn?.typeOf, 'widget');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit src/emit/tests/to-json-own.test.ts`
Expected: FAIL — `toJSONOwn` is not exported.

- [ ] **Step 3: Implement `toJSONOwn`**

Add to `TODL/src/emit/json.ts` (after `toJSON`):

```ts
/**
 * Own-scoped emit: serialise only the nodes in `ownIds` and their out-edges.
 * An out-edge whose `to` is not in `ownIds` (a reference to a base node) is
 * kept as a dangling id — resolved at load when the base package is also
 * loaded. Bases never reference own nodes, so no own-relevant edge is missed.
 */
export function toJSONOwn(model: Repository, ownIds: ReadonlySet<NodeId>): TodlDocument {
  const nodes: JsonNode[] = [];
  const edges: JsonEdge[] = [];
  for (const node of model.allNodes()) {
    if (!ownIds.has(node.id)) continue;
    nodes.push({
      id: node.id,
      tier: Tier[node.tier],
      typeOf: node.typeOf,
      attrs: Object.fromEntries(node.attrs),
    });
    for (const edge of model.outEdges(node.id)) {
      edges.push({ kind: EdgeKind[edge.kind], via: edge.via, from: edge.from, to: edge.to });
    }
  }
  return { nodes, edges };
}
```

- [ ] **Step 4: Export it**

In `TODL/src/index.ts`, extend the `emit/json.js` export block to include `toJSONOwn`:

```ts
export {
  toJSON,
  toJSONOwn,
  fromJSON,
  graphFromJSON,
  type TodlDocument,
  type JsonNode,
  type JsonEdge,
} from "./emit/json.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit src/emit/tests/to-json-own.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd TODL && git add src/emit/json.ts src/index.ts src/emit/tests/to-json-own.test.ts
git commit -m "feat(publish): add toJSONOwn provenance-filtered emitter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: TODL — `deriveClasses` annotation enrichment from a separate document

**Files:**
- Modify: `TODL/src/publish/reflect.ts:74-88`
- Test: `TODL/src/publish/tests/reflect.test.ts`

**Interfaces:**
- Consumes: existing `projectAnnotations(model, targetId)`, `TodlDocument`, `PublishedClass`.
- Produces: `export function deriveClasses(model: TodlDocument, annotationsFrom?: TodlDocument): PublishedClass[]` — enumerates instantiable classes from `model`, but resolves each class's annotations (icon/label) against `annotationsFrom ?? model`. This lets callers enumerate an OWN-only document while still resolving annotations that inherit from base annotation declarations in the full closure.

- [ ] **Step 1: Write the failing test**

```ts
// TODL/src/publish/tests/reflect.test.ts  (add to the existing file, or create it)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check, checkAgainst } from '../../api.js';
import { toJSON, toJSONOwn } from '../../emit/json.js';
import { deriveClasses } from '../reflect.js';

describe('deriveClasses annotationsFrom', () => {
  test('enumerates own classes but resolves icons from the full document', () => {
    // Base defines the `icon` annotation + a `widget` concept.
    const baseSrc = 'annotation icon { path : string; }\nconcept widget;';
    const base = toJSON(check([{ uri: 'm.todl', text: baseSrc }]).model);
    // Own library: a class annotated with the base `icon` annotation.
    const { model, provenance } = checkAgainst([base], [
      { uri: 'l.todl', text: 'widget Button { class = true; annotate icon { path = "b.svg"; } }' },
    ]);
    const ownIds = new Set(provenance.keys());
    const ownDoc = toJSONOwn(model, ownIds);
    const fullDoc = toJSON(model);

    const classes = deriveClasses(ownDoc, fullDoc);
    assert.equal(classes.length, 1, 'only the own class, not base widget');
    assert.equal(classes[0].id, 'Button');
    assert.equal(classes[0].icon, 'b.svg', 'icon resolved via annotation');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit src/publish/tests/reflect.test.ts`
Expected: FAIL — `deriveClasses` takes one argument / icon undefined.

- [ ] **Step 3: Implement the change**

Replace `deriveClasses` in `TODL/src/publish/reflect.ts`:

```ts
export function deriveClasses(model: TodlDocument, annotationsFrom?: TodlDocument): PublishedClass[] {
  const annModel = annotationsFrom ?? model;
  const out: PublishedClass[] = [];
  for (const n of model.nodes) {
    const attrs = n.attrs as Record<string, unknown>;
    if (n.tier !== "Instance" || attrs.class !== true) continue;
    const cls: PublishedClass = { id: n.id, concept: n.typeOf };
    if (typeof attrs.id === "string") cls.localId = attrs.id;
    if (typeof attrs.label === "string") cls.label = attrs.label;
    const iconAnn = projectAnnotations(annModel, n.id).icon;
    const iconPath = iconAnn === undefined ? undefined : iconAnn.path;
    if (typeof iconPath === "string") cls.icon = iconPath;
    out.push(cls);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit src/publish/tests/reflect.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full TODL suite (guard against regressions in existing deriveClasses callers)**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit "src/**/*.test.ts"`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
cd TODL && git add src/publish/reflect.ts src/publish/tests/reflect.test.ts
git commit -m "feat(publish): deriveClasses resolves annotations from an optional full document

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: TODL — own-only `compilePackage` with dependencies + full document

**Files:**
- Modify: `TODL/src/publish/publish.ts`
- Modify: `TODL/src/index.ts`
- Test: `TODL/src/publish/tests/compile-package.test.ts`

**Interfaces:**
- Consumes: `checkAgainst` (now destructure `provenance`), `toJSON`, `toJSONOwn`, `deriveClasses(model, annotationsFrom)`, `PublishedClass`.
- Produces:
  - `export enum PackageKind { MetaModel = 'meta-model', Library = 'library' }`
  - `export interface PackageRef { kind: PackageKind; id: string; version: string }`
  - `export interface PackageDocument extends TodlDocument { dependencies?: PackageRef[] }`
  - `compilePackage(bases, sources, identity, dependencies?: readonly PackageRef[]): CompileOutcome`
  - `publish(bases, sources, store, identity, dependencies?): Promise<PublishOutcome>`
  - `CompiledPackage.document: PackageDocument` (own-only, carries `dependencies`), `CompiledPackage.fullDocument: TodlDocument` (closure).

- [ ] **Step 1: Write the failing test**

```ts
// TODL/src/publish/tests/compile-package.test.ts  (add cases)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../../api.js';
import { toJSON } from '../../emit/json.js';
import { compilePackage, PackageKind } from '../publish.js';

describe('compilePackage own-only', () => {
  test('document is own-only + carries dependencies; fullDocument is the closure', () => {
    const base = toJSON(check([{ uri: 'm.todl', text: 'concept widget;' }]).model);
    const deps = [{ kind: PackageKind.MetaModel, id: 'meta', version: '1.0.0' }];
    const outcome = compilePackage(
      [base],
      [{ uri: 'l.todl', text: 'widget Button { class = true; }' }],
      { id: 'lib', version: '0.1.0' },
      deps,
    );
    assert.ok(outcome.ok && outcome.package);
    const pkg = outcome.package!;
    const ownIds = new Set(pkg.document.nodes.map((n) => n.id));
    assert.ok(ownIds.has('Button'), 'own node present');
    assert.ok(!ownIds.has('widget'), 'base node excluded from document');
    assert.deepEqual(pkg.document.dependencies, deps, 'dependencies recorded');
    // fullDocument is the closure (includes the base node).
    assert.ok(pkg.fullDocument.nodes.some((n) => n.id === 'widget'), 'fullDocument has base');
    // Derived classes are own-only.
    assert.equal(pkg.classes.length, 1);
    assert.equal(pkg.classes[0].id, 'Button');
  });

  test('omitted dependencies leaves the field undefined', () => {
    const outcome = compilePackage([], [{ uri: 'm.todl', text: 'concept widget;' }], { id: 'meta', version: '1.0.0' });
    assert.ok(outcome.ok && outcome.package);
    assert.equal(outcome.package!.document.dependencies, undefined);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit src/publish/tests/compile-package.test.ts`
Expected: FAIL — `PackageKind` not exported / `fullDocument` missing / `widget` present in document.

- [ ] **Step 3: Rewrite `publish.ts`**

Replace the types + `compilePackage` + `publish` in `TODL/src/publish/publish.ts`:

```ts
import { checkAgainst } from "../api.js";
import { toJSON, toJSONOwn, type TodlDocument } from "../emit/json.js";
import { Severity, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/span.js";
import { deriveClasses, type PublishedClass } from "./reflect.js";
import type { PackageStore } from "./stores.js";

export enum PackageKind {
  MetaModel = "meta-model",
  Library = "library",
}

/** A pinned reference to a base package this one was compiled against. */
export interface PackageRef {
  kind: PackageKind;
  id: string;
  version: string;
}

export interface PackageIdentity {
  id: string;
  version: string;
  name?: string;
}

/** The persisted model.json: a TodlDocument plus recorded base deps. The extra
 *  field is ignored by graphFromJSON and the `bases: TodlDocument[]` path. */
export interface PackageDocument extends TodlDocument {
  dependencies?: PackageRef[];
}

export interface CompiledPackage extends PackageIdentity {
  document: PackageDocument;        // own-only + dependencies — persisted as model.json
  fullDocument: TodlDocument;       // the full closure — for presentation/annotation baking
  sources: readonly SourceFile[];   // raw .todl passthrough (persisted under src/)
  classes: readonly PublishedClass[]; // instantiable palette classes (own-only)
}

export interface CompileOutcome {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[];
  package?: CompiledPackage;
}

export interface PublishOutcome extends CompileOutcome {
  persisted: boolean;
}

export function compilePackage(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  identity: PackageIdentity,
  dependencies?: readonly PackageRef[],
): CompileOutcome {
  const { model, diagnostics, provenance } = checkAgainst([...bases], [...sources]);
  const errors = diagnostics.filter((d) => d.severity === Severity.Error);
  if (errors.length > 0) return { ok: false, diagnostics, errors };

  const ownIds = new Set(provenance.keys());
  const fullDocument = toJSON(model);
  const document: PackageDocument = toJSONOwn(model, ownIds);
  if (dependencies !== undefined && dependencies.length > 0) {
    document.dependencies = [...dependencies];
  }
  const pkg: CompiledPackage = {
    ...identity,
    document,
    fullDocument,
    sources,
    classes: deriveClasses(document, fullDocument),
  };
  return { ok: true, diagnostics, errors, package: pkg };
}

export async function publish(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  store: PackageStore,
  identity: PackageIdentity,
  dependencies?: readonly PackageRef[],
): Promise<PublishOutcome> {
  const outcome = compilePackage(bases, sources, identity, dependencies);
  if (!outcome.ok || outcome.package === undefined) return { ...outcome, persisted: false };
  await store.persist(outcome.package);
  return { ...outcome, persisted: true };
}
```

- [ ] **Step 4: Export the new types**

In `TODL/src/index.ts`, extend the `publish/publish.js` export block:

```ts
export {
  compilePackage,
  publish,
  PackageKind,
  type PackageRef,
  type PackageIdentity,
  type PackageDocument,
  type CompiledPackage,
  type CompileOutcome,
  type PublishOutcome,
} from "./publish/publish.js";
```

- [ ] **Step 5: Run the new test + full suite**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit src/publish/tests/compile-package.test.ts`
Then: `cd TODL && npx tsx --conditions=development --test --test-force-exit "src/**/*.test.ts"`
Expected: all green. (The pre-existing `publish.test.ts` / `blob-store.test.ts` still pass — `BlobPackageStore.persist` writes `pkg.document`, which is still a valid JSON object.)

- [ ] **Step 6: Commit**

```bash
cd TODL && git add src/publish/publish.ts src/index.ts src/publish/tests/compile-package.test.ts
git commit -m "feat(publish): emit own-only model.json with recorded dependencies

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: TODL — version bump + publish to Verdaccio

**Files:**
- Modify: `TODL/package.json`

**Interfaces:**
- Produces: a published `@pragmatic-lab/todl` version on Verdaccio carrying Tasks 1-3, for Plexus to consume.

- [ ] **Step 1: Bump the minor version**

```bash
cd TODL && npm version minor --no-git-tag-version
```
Note the new version printed (e.g. `v0.32.0`) — Plexus Task 5 pins it.

- [ ] **Step 2: Run the full suite one more time**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit "src/**/*.test.ts"`
Expected: all green.

- [ ] **Step 3: Publish to Verdaccio**

```bash
cd TODL && npm publish --registry http://localhost:4873
```
Expected: `+ @pragmatic-lab/todl@<new version>`.

- [ ] **Step 4: Commit the version bump**

```bash
cd TODL && git add package.json
git commit -m "chore: publish <new version> (own-content packages)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Plexus — transitive `resolveBases`

**Files:**
- Modify: `Plexus/package.json` (bump `@pragmatic-lab/todl`)
- Modify: `Plexus/src/renderer/src/services/projects/base-resolver.ts`
- Test: `Plexus/src/renderer/src/services/projects/tests/base-resolver.test.ts`

**Interfaces:**
- Consumes: `PackageDocument`/`PackageRef` (via the read `model.json`), `BaseBindings`, `BaseRef`, `ensureMetaModelsBackend`, `ensureLibrariesBackend`, `IStorage`.
- Produces: `resolveBases(provider, bindings)` now returns the TRANSITIVE closure of base documents (deduped by `id@version`, cycle-safe). Signature unchanged: `Promise<{ bases: TodlDocument[]; problems: string[] }>`.

- [ ] **Step 1: Bump the TODL dependency + reinstall**

In `Plexus/package.json` set `"@pragmatic-lab/todl": "^<new version from Task 4>"`, then:
```bash
cd Plexus && rm -rf node_modules/@pragmatic-lab/todl && npm install @pragmatic-lab/todl@<new version> --registry http://localhost:4873 --no-save
```

- [ ] **Step 2: Write the failing test**

```ts
// Plexus/src/renderer/src/services/projects/tests/base-resolver.test.ts
import { describe, it, expect } from 'vitest'
import { resolveBases } from '../base-resolver.js'

// Minimal in-memory backends: a StorageProviderRegistry stub keyed by backend id,
// each returning an IStorage whose ReadText serves a fixture map of path→json.
function makeProvider(metaFiles: Record<string, string>, libFiles: Record<string, string>) {
  const store = (files: Record<string, string>) => ({
    async ReadText(path: string) {
      const hit = files[path]
      if (hit === undefined) throw new Error(`missing ${path}`)
      return hit
    },
  })
  const registry = {
    Has: () => true,
    Register: () => {},
    Create: (id: string) => (id === 'meta-models' ? store(metaFiles) : store(libFiles)),
  }
  // Provider stub: getRequired(StorageProviderRegistry.Key) → registry.
  return {
    getRequired: () => registry,
  } as never
}

const doc = (nodes: string[], dependencies?: unknown[]) =>
  JSON.stringify({
    nodes: nodes.map((id) => ({ id, tier: 'Type', typeOf: 'element', attrs: {} })),
    edges: [],
    ...(dependencies ? { dependencies } : {}),
  })

describe('resolveBases transitive', () => {
  it('walks a library dependency to its meta-model, deduping', async () => {
    const provider = makeProvider(
      { 'meta/1.0.0/model.json': doc(['widget']) },
      { 'lib/0.1.0/model.json': doc(['Button'], [{ kind: 'meta-model', id: 'meta', version: '1.0.0' }]) },
    )
    const { bases, problems } = await resolveBases(provider, {
      libraries: [{ id: 'lib', version: '0.1.0' }],
    })
    expect(problems).toEqual([])
    const ids = bases.flatMap((b) => b.nodes.map((n) => n.id))
    expect(ids).toContain('Button')
    expect(ids).toContain('widget')
  })

  it('surfaces a missing transitive dependency as a problem', async () => {
    const provider = makeProvider(
      {},
      { 'lib/0.1.0/model.json': doc(['Button'], [{ kind: 'meta-model', id: 'meta', version: '9.9.9' }]) },
    )
    const { problems } = await resolveBases(provider, { libraries: [{ id: 'lib', version: '0.1.0' }] })
    expect(problems.some((p) => p.includes('meta') && p.includes('9.9.9'))).toBe(true)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/base-resolver.test.ts`
Expected: FAIL — current `resolveBases` is flat, does not read `dependencies` (the diamond `widget` node absent).

- [ ] **Step 4: Rewrite `base-resolver.ts` as a transitive walk**

```ts
import type { IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { TodlDocument, PackageRef } from '@pragmatic-lab/todl'
import { PackageKind } from '@pragmatic-lab/todl'

import type { IStorage } from '../storage/storage.js'
import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'
import type { BaseBindings, BaseRef } from './base-binding.js'

// A model.json read back: the graph plus any recorded base deps.
interface PackageDocument extends TodlDocument { dependencies?: PackageRef[] }

// Resolve a project's declared bases into parsed TodlDocuments, walking each
// package's recorded `dependencies` transitively. Deduped by `id@version`
// (cycle-safe); a binding whose model.json is missing/unreadable is collected in
// `problems` rather than thrown. TODL's checkAgainst/mergeBases dedups any
// residual node overlap.
export async function resolveBases(
  provider: IServiceProvider,
  bindings: BaseBindings,
): Promise<{ bases: TodlDocument[]; problems: string[] }> {
  const bases: TodlDocument[] = []
  const problems: string[] = []
  const visited = new Set<string>()

  const backendFor = (kind: PackageKind): IStorage =>
    kind === PackageKind.Library ? ensureLibrariesBackend(provider) : ensureMetaModelsBackend(provider)

  const queue: PackageRef[] = []
  if (bindings.metaModel !== undefined)
    queue.push({ kind: PackageKind.MetaModel, ...bindings.metaModel })
  for (const lib of bindings.libraries ?? [])
    queue.push({ kind: PackageKind.Library, ...lib })

  while (queue.length > 0) {
    const ref = queue.shift()!
    const key = `${ref.kind}:${ref.id}@${ref.version}`
    if (visited.has(key)) continue
    visited.add(key)

    const path = `${ref.id}/${ref.version}/model.json`
    try {
      const doc = JSON.parse(await backendFor(ref.kind).ReadText(path)) as PackageDocument
      bases.push({ nodes: doc.nodes, edges: doc.edges })
      for (const dep of doc.dependencies ?? []) queue.push(dep)
    } catch {
      const kind = ref.kind === PackageKind.Library ? 'library' : 'meta-model'
      problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
    }
  }
  return { bases, problems }
}
```

Note: `BaseRef` (`{ id, version }`) spreads into a `PackageRef` by adding `kind`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/base-resolver.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full Plexus suite**

Run: `cd Plexus && npx vitest run`
Expected: green (old full-closure `model.json` fixtures have no `dependencies` → treated as leaves → unchanged behavior).

- [ ] **Step 7: Commit**

```bash
cd Plexus && git add package.json package-lock.json src/renderer/src/services/projects/base-resolver.ts src/renderer/src/services/projects/tests/base-resolver.test.ts
git commit -m "feat(projects): resolve base dependencies transitively

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Plexus — library publish records dependencies

**Files:**
- Modify: `Plexus/src/renderer/src/modules/library/services/library-project-factory.ts:117-171`
- Test: `Plexus/src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`

**Interfaces:**
- Consumes: `compilePackage(bases, sources, identity, dependencies)`, `PackageKind`, `PackageRef` from `@pragmatic-lab/todl`; `resolveBases`; the project `LibraryManifest` (`metaModel`, `libraries?`).
- Produces: the published library `model.json` carries `dependencies` = its meta-model (+ library) bindings; presentation is baked from `pkg.document` (own-only).

- [ ] **Step 1: Write / extend the failing test**

Add a case asserting the published `model.json` contains `dependencies` with the meta-model ref and does NOT contain base nodes. (Follow the existing test's harness for building a library project + stub backends; assert on the written `model.json` JSON.)

```ts
// in library-project-factory.test.ts
it('records the meta-model dependency and omits base nodes from model.json', async () => {
  // ...arrange a library bound to meta-model M@1.0.0 with one taxonomy class,
  // publish it against a published M, then read the written model.json...
  const written = JSON.parse(publishedFiles['lib/0.1.0/model.json'])
  expect(written.dependencies).toContainEqual({ kind: 'meta-model', id: 'M', version: '1.0.0' })
  expect(written.nodes.some((n: { id: string }) => n.id === 'M')).toBe(false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: FAIL — no `dependencies` on the written document.

- [ ] **Step 3: Build the dependency list and pass it to `compilePackage`**

In `library-project-factory.ts` `publish()`, after `resolveBases`, build refs from the manifest and thread them through:

```ts
import { PackageKind, type PackageRef } from '@pragmatic-lab/todl'
// ...
const dependencies: PackageRef[] = [
  { kind: PackageKind.MetaModel, id: manifest.metaModel.id, version: manifest.metaModel.version },
  ...(manifest.libraries ?? []).map((l) => ({ kind: PackageKind.Library, id: l.id, version: l.version })),
]

const outcome = compilePackage(bases, sources, {
  id: manifest.id,
  version: manifest.libVersion,
  name: manifest.name ?? manifest.id,
}, dependencies)
```

- [ ] **Step 4: Bake presentation from the own-only document**

The presentation call already receives `doc = pkg.document`, which is now own-only — no change needed there (own classes, direct icons resolve; `pkg.classes` remains icon-correct because TODL enriched it from the full model in Task 3). Confirm the existing `publishLibraryPresentation(storage, dest, base, doc)` line still passes `pkg.document`.

- [ ] **Step 5: Run the test + suite**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Then: `cd Plexus && npx vitest run`
Expected: green.

- [ ] **Step 6: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/library/services/library-project-factory.ts src/renderer/src/modules/library/services/tests/library-project-factory.test.ts
git commit -m "feat(library): record base dependencies on publish

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Plexus — meta-model publish records dependencies

**Files:**
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Test: `Plexus/src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`

**Interfaces:**
- Consumes: `compilePackage(bases, sources, identity, dependencies)`, `PackageKind`, `PackageRef`; the meta-model project's `BaseBindings` (usually none).
- Produces: a meta-model `model.json` that is own-only; `dependencies` reflects any bound bases (typically absent → `dependencies` omitted).

- [ ] **Step 1: Write the failing test**

```ts
it('publishes an own-only model.json (no prelude nodes, no dependencies when unbound)', async () => {
  // ...arrange + publish a standalone meta-model project...
  const written = JSON.parse(publishedFiles['meta/1.0.0/model.json'])
  expect(written.dependencies).toBeUndefined()
  expect(written.nodes.some((n: { id: string }) => n.id === 'element')).toBe(false) // prelude excluded
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: FAIL — prelude nodes present in the written document (pre-own-only build) OR the factory doesn't yet pass deps.

- [ ] **Step 3: Thread dependencies through the meta-model publish**

Mirror Task 6: build `PackageRef[]` from the meta-model project's own `BaseBindings` (meta-models usually declare none, so the list is empty and `dependencies` is omitted), and pass it as the 4th arg to `compilePackage`. If the factory publishes via TODL's `publish(...)`/store rather than `compilePackage` directly, thread the same `dependencies` argument through that call.

- [ ] **Step 4: Run the test + suite**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Then: `cd Plexus && npx vitest run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts
git commit -m "feat(meta-model): own-only publish with recorded dependencies

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Migration + live acceptance

**Files:** none (operational + verification).

**Interfaces:**
- Consumes: the full stack from Tasks 1-7.
- Produces: a republished corpus (own-only) and a validated end-to-end round-trip.

- [ ] **Step 1: Build Plexus**

Run: `cd Plexus && npm run build`
Expected: clean build against the new TODL.

- [ ] **Step 2: Republish the corpus (meta-models first, then libraries)**

Launch Plexus and republish each meta-model project, then each library project (their publish now emits own-only + records deps). Use the app's publish action for each producer project in the test workspace.

- [ ] **Step 3: Verify a published library `model.json` is own-only**

Read `<userData>/libraries/<id>/<version>/model.json` and confirm: no prelude nodes (e.g. `element`, `string`), no meta-model nodes, and a `dependencies` array naming the meta-model at its exact version.

- [ ] **Step 4: Acceptance — an architecture project validates with zero undefined references**

Open an architecture project bound to a republished meta-model + library. Confirm the Problems panel shows zero `reference.undefined` diagnostics — i.e. the transitive resolver reassembled the closure from own-only packages. This is the end-to-end acceptance test for the whole change.

- [ ] **Step 5: Report**

Summarize: corpus republished, a sample library `model.json` shrank to own content, arch validation clean. Do NOT merge/push — hand back to the user for the merge decision (per Global Constraints).

---

## Notes for the executor

- Old full-closure packages remain loadable (no `dependencies` field → leaf), so Tasks 5-7 can land before the Task 8 republish without breaking open projects.
- If `deriveClasses` has other in-repo callers that pass a full closure today, they keep working — `annotationsFrom` is optional and defaults to the enumeration document.
- The `checkAgainst` return already includes `provenance`; only own nodes are keys (bases/prelude are seeded, never loaded through `loadInto`) — this is the invariant Task 1/Task 3 rely on.
