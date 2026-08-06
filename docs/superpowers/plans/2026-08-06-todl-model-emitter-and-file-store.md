# TODL Model Emitter + File Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a `ModelDraft`'s own model as round-trippable `.todl` source (`ModelDraft.toTodl()`), and add a file-persistence backend (`TodlFileStore` over a `FileIO` seam) that saves/loads a model as `.todl` code.

**Architecture:** A pure `.todl` model emitter in `src/emit/todl.ts` (ported from Plexus `todl-emitter.ts`, with `deriveBindings` re-sourced from `ModelDraft`'s combined `Repository` + base-id set instead of base docs). `ModelDraft.toTodl()` feeds its own delta (`toJSON()`) + derived bindings to the emitter. `TodlFileStore` wraps a `FileIO { read, write }` seam: `save` writes `draft.toTodl()`, `load` reparses via `checkAgainst`. All fake-tested; round-trip proven through the real parser.

**Tech Stack:** TypeScript (ESM, strict), Node's built-in test runner via `tsx`. **No new runtime dependencies** (file I/O is behind the `FileIO` seam).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-06-todl-model-emitter-and-file-store-design.md`.
- **Emits models, not meta-models.** Only own instances (+ their reference edges + own classes) are emitted, inside a `model <id> : <metaModel> [uses …] { … }` block; bases are named, never copied.
- **Type-directed, no sigil (todl ≥ 0.14):** reference values are bare/dotted names (no `&`); instance own id/concept/`instanceof` use the local (un-dotted) name; **reference targets keep their full id**. Structural marker attrs (`id`, `class`, `namespace`) are never emitted as fields.
- **Round-trip is the correctness gate:** `checkAgainst(baseDocs, [{path, content: toTodl()}])` reconstructs the same instances with **zero new diagnostics**.
- **File I/O is a seam** (`FileIO`); no `node:fs` in TODL. Concrete adapter is a consumer concern.
- **Degrade gracefully without namespaces:** bases lacking a `namespace` attr → `metaModel` falls back to the draft namespace, `imports`/`uses` empty; never throw.
- **Additive only.** New files + `ModelDraft.toTodl()` + exports; existing behaviour and all existing tests unchanged.
- **Every test file lives in a `tests/` subfolder.** Use real enums.
- Test: `npx tsx --conditions=development --test "src/**/*.test.ts"`. Typecheck: `npm run typecheck`. Build: `npm run build`.

### File structure

- `src/emit/todl.ts` *(create)* — `deriveBindings`, `emitModelTodl`, `type ModelBindings`.
- `src/authoring/model-draft.ts` *(modify)* — `toTodl()`.
- `src/authoring/file-store.ts` *(create)* — `FileIO`, `TodlFileStore`.
- `src/index.ts` *(modify)* — export the emitter + file store + `FileIO`/`ModelBindings`.
- `src/emit/tests/todl.test.ts` *(create)* — emitter + deriveBindings + round-trip.
- `src/authoring/tests/file-store.test.ts` *(create)* — save/load through a fake `FileIO`.

---

## Task 1: The `.todl` model emitter (`src/emit/todl.ts`)

**Files:**
- Create: `src/emit/todl.ts`
- Test: `src/emit/tests/todl.test.ts` (create — emitter + deriveBindings parts)

**Interfaces:**
- Consumes: `TodlDocument`/`JsonNode` (`src/emit/json.js`); `Repository` (`src/model/model.js`); `MetaKind` (`src/model/kinds.js`); `NodeId`, `Scalar` (`src/model/graph.js`).
- Produces:
  - `interface ModelBindings { metaModel: string; uses: string[]; imports: string[]; }`
  - `deriveBindings(model: Repository, baseIds: ReadonlySet<NodeId>, namespace: string, own: TodlDocument): ModelBindings`
  - `emitModelTodl(own: TodlDocument, namespace: string, bindings: ModelBindings): string`

- [ ] **Step 1: Write the failing test**

Create `src/emit/tests/todl.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { toJSON } from "../json.js";
import { deriveBindings, emitModelTodl } from "../todl.js";

// A namespaced meta-model base: concept `component` { label; implemented-by : technology }.
function base(): Repository {
  const r = new Repository();
  const b = r.builder().setNamespace("acme.ea");
  b.definePrimitive("string");
  b.defineConcept("technology");
  b.defineConcept("component");
  b.addField("component", "label", "string");
  b.addField("component", "implemented-by", "technology");
  b.commit();
  return r;
}

// Own delta: a component `gw` with a label + a cross-boundary ref to `copilot`.
function ownDoc(): { own: ReturnType<typeof toJSON>; model: Repository; baseIds: Set<string> } {
  const model = base();
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  const b = model.builder();
  b.assertInstance("technology", "copilot"); // pretend a library instance
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "implemented-by", "copilot");
  b.commit();
  // own delta = non-base nodes + their edges
  const own = { nodes: [], edges: [] } as ReturnType<typeof toJSON>;
  const full = toJSON(model);
  for (const n of full.nodes) if (!baseIds.has(n.id)) own.nodes.push(n);
  for (const e of full.edges) if (!baseIds.has(e.from)) own.edges.push(e);
  return { own, model, baseIds };
}

test("deriveBindings finds the meta-model namespace and drops own from imports", () => {
  const { own, model, baseIds } = ownDoc();
  const bindings = deriveBindings(model, baseIds, "acme.app", own);
  assert.equal(bindings.metaModel, "acme.ea");
  assert.deepEqual(bindings.imports, ["acme.ea"]);
});

test("emitModelTodl emits a namespace + model block with instances and references", () => {
  const { own, model, baseIds } = ownDoc();
  const bindings = deriveBindings(model, baseIds, "acme.app", own);
  const src = emitModelTodl(own, "acme.app", bindings);
  assert.match(src, /namespace acme\.app/);
  assert.match(src, /import acme\.ea;/);
  assert.match(src, /model acme\.app-model : acme\.ea \{/);
  assert.match(src, /component gw \{/);
  assert.match(src, /label = "Gateway";/);
  assert.match(src, /implemented-by = copilot;/);
});

test("emitModelTodl degrades without base namespaces (fallback meta-model)", () => {
  const model = new Repository();
  const b = model.builder();
  b.defineConcept("component");
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  b.assertInstance("component", "gw");
  b.commit();
  const own = { nodes: toJSON(model).nodes.filter((n) => !baseIds.has(n.id)), edges: [] };
  const bindings = deriveBindings(model, baseIds, "app", own);
  assert.equal(bindings.metaModel, "app"); // fallback to draft namespace
  const src = emitModelTodl(own, "app", bindings);
  assert.match(src, /model app-model : app \{/);
  assert.match(src, /component gw \{\}/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/emit/tests/todl.test.ts`
Expected: FAIL — cannot resolve `../todl.js`.

- [ ] **Step 3: Implement `src/emit/todl.ts`**

Ported from Plexus `todl-emitter.ts` (`deriveBindings` re-sourced from the live `Repository`):

```ts
/**
 * Emit a model's OWN delta as round-trippable `.todl` source (design: model
 * emitter + file store). Type-directed (todl ≥ 0.14): reference values are bare
 * or dotted names (no sigil); instance own id/concept/instanceof use the local
 * name, reference targets keep their full id. Ported from Plexus `todl-emitter.ts`.
 */

import { MetaKind } from "../model/kinds.js";
import { type NodeId, type Scalar } from "../model/graph.js";
import { Repository } from "../model/model.js";
import { type TodlDocument, type JsonNode } from "./json.js";

/** The default-library (prelude) namespace — a base, never a project binding. */
const PRELUDE_NAMESPACE = "todl";
/** Attrs that are markers, not authored fields. */
const MARKER_ATTRS = new Set(["id", "class", "namespace"]);

export interface ModelBindings {
  metaModel: string;
  uses: string[];
  imports: string[];
}

/** Derive a model's bindings from the combined model + base-id set + own delta. */
export function deriveBindings(
  model: Repository,
  baseIds: ReadonlySet<NodeId>,
  namespace: string,
  own: TodlDocument,
): ModelBindings {
  const baseNs = new Set<string>();
  const taxIds = new Set<string>();
  for (const node of model.allNodes()) {
    if (!baseIds.has(node.id)) continue;
    const ns = node.attrs.get("namespace");
    if (typeof ns === "string" && ns.length > 0 && ns !== PRELUDE_NAMESPACE) baseNs.add(ns);
    if (node.typeOf === MetaKind.Taxonomy) taxIds.add(node.id);
  }
  const taxonomyOf = (id: string): string | undefined => {
    const dot = id.indexOf(".");
    if (dot < 0) return undefined;
    const tax = id.slice(0, dot);
    return taxIds.has(tax) ? tax : undefined;
  };
  const usesSet = new Set<string>();
  for (const edge of own.edges) {
    const tax = taxonomyOf(String(edge.to));
    if (tax !== undefined) usesSet.add(tax);
  }
  const sortedBase = [...baseNs].sort();
  const metaModel = sortedBase[0] ?? namespace;
  const imports = sortedBase.filter((n) => n !== namespace);
  return { metaModel, uses: [...usesSet].sort(), imports };
}

/** The local (un-dotted) name of an id — for the instance's own id/concept/class. */
function localName(id: string): string {
  const i = id.lastIndexOf(".");
  return i >= 0 ? id.slice(i + 1) : id;
}

function literal(v: Scalar): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

export function emitModelTodl(own: TodlDocument, namespace: string, bindings: ModelBindings): string {
  const instances = own.nodes;
  const classes = instances.filter((n) => (n.attrs as Record<string, unknown>).class === true);
  const concrete = instances.filter((n) => (n.attrs as Record<string, unknown>).class !== true);

  const instanceOf = new Map<string, string>();
  const rels = new Map<string, Array<{ via: string; to: string }>>();
  for (const e of own.edges) {
    const from = String(e.from);
    if (e.kind === "InstanceOf") instanceOf.set(from, String(e.to));
    else if (e.kind === "Relationship" && e.via !== null) {
      const list = rels.get(from) ?? [];
      list.push({ via: String(e.via), to: String(e.to) });
      rels.set(from, list);
    }
  }

  const lines: string[] = [`namespace ${namespace}`, "{"];
  for (const ns of bindings.imports) lines.push(`  import ${ns};`);
  for (const n of classes) lines.push(...emitOne(n, instanceOf.get(n.id), rels.get(n.id) ?? []));
  if (concrete.length > 0) {
    const uses = bindings.uses.length > 0 ? ` uses ${bindings.uses.join(", ")}` : "";
    lines.push(`  model ${namespace}-model : ${bindings.metaModel}${uses} {`);
    for (const n of concrete) {
      for (const l of emitOne(n, instanceOf.get(n.id), rels.get(n.id) ?? [])) lines.push(`  ${l}`);
    }
    lines.push("  }");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function emitOne(node: JsonNode, cls: string | undefined, relEdges: Array<{ via: string; to: string }>): string[] {
  const concept = localName(node.typeOf);
  const isClass = (node.attrs as Record<string, unknown>).class === true;
  const head = isClass
    ? `class ${concept} ${localName(node.id)}`
    : cls !== undefined
      ? `${concept} ${localName(node.id)} instanceof ${localName(cls)}`
      : `${concept} ${localName(node.id)}`;

  const body: string[] = [];
  for (const [name, value] of Object.entries(node.attrs)) {
    if (MARKER_ATTRS.has(name)) continue;
    body.push(`${name} = ${literal(value as Scalar)};`);
  }
  const byMember = new Map<string, string[]>();
  for (const r of relEdges) {
    const list = byMember.get(r.via) ?? [];
    list.push(r.to);
    byMember.set(r.via, list);
  }
  for (const [member, targets] of byMember) {
    body.push(targets.length === 1 ? `${member} = ${targets[0]};` : `${member} = [${targets.join(", ")}];`);
  }

  if (body.length === 0) return [`  ${head} {}`];
  return [`  ${head} {`, ...body.map((b) => `    ${b}`), "  }"];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/emit/tests/todl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: green; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/emit/todl.ts src/emit/tests/todl.test.ts
git commit -m "feat(emit): .todl model emitter (deriveBindings + emitModelTodl)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `ModelDraft.toTodl()` + round-trip

**Files:**
- Modify: `src/authoring/model-draft.ts` (add `toTodl()`)
- Test: `src/authoring/tests/model-draft-serialize.test.ts` (append round-trip)

**Interfaces:**
- Consumes: `deriveBindings`, `emitModelTodl` (Task 1); `checkAgainst`/`toJSON` for the round-trip test.
- Produces: `ModelDraft.toTodl(): string`.

- [ ] **Step 1: Write the failing round-trip test**

Append to `src/authoring/tests/model-draft-serialize.test.ts`:

```ts
import { checkAgainst } from "../../api.js";

test("toTodl emits .todl that round-trips through checkAgainst", () => {
  const { base, draft } = draftWithGw();
  const todl = draft.toTodl();
  const { model, diagnostics } = checkAgainst([toJSON(base)], [{ path: "app.todl", content: todl }]);
  assert.deepEqual(diagnostics, []); // valid, no new diagnostics
  assert.equal(model.entity("gw")!.field("label"), "Gateway");
  assert.equal(model.entity("gw")!.ref("implemented-by")!.id, "copilot");
});
```

> Note: `draftWithGw()` (already in this file) builds a base with concept `component` (`label`, `implemented-by : technology`) + a `technology` instance `copilot`, opens a draft, and adds `gw`. If the base lacks a `namespace`, the emitted `model` binds the draft namespace as a fallback meta-model — still round-trips because the instances resolve against the merged base + prelude. Confirm 0 diagnostics; if the fallback binding causes a `model.binding-undefined`, give the base a namespace in `draftWithGw` (via `builder().setNamespace(...)`) and pass that namespace to the draft.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/authoring/tests/model-draft-serialize.test.ts`
Expected: FAIL — `draft.toTodl is not a function`.

- [ ] **Step 3: Implement `toTodl`**

Add to `src/authoring/model-draft.ts` (and import the emitter):

```ts
import { deriveBindings, emitModelTodl } from "../emit/todl.js";
```

```ts
  /** Serialize the overlay as round-trippable `.todl` model source (own delta + bindings). */
  toTodl(): string {
    const own = this.toJSON();
    const bindings = deriveBindings(this.model, this.baseIds, this.namespace, own);
    return emitModelTodl(own, this.namespace, bindings);
  }
```

> `baseIds` is currently `private`. If `deriveBindings` is called with it, keep it private and pass `this.baseIds` directly (same-class access) — no visibility change needed since `toTodl` is a `ModelDraft` method.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/authoring/tests/model-draft-serialize.test.ts`
Expected: PASS. If the round-trip reports diagnostics, follow the Step-1 note (give the base a namespace) and re-run.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: green; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/authoring/model-draft.ts src/authoring/tests/model-draft-serialize.test.ts
git commit -m "feat(authoring): ModelDraft.toTodl() — emit + round-trip the overlay as .todl

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `TodlFileStore` + `FileIO` seam + exports

**Files:**
- Create: `src/authoring/file-store.ts`
- Modify: `src/index.ts`
- Test: `src/authoring/tests/file-store.test.ts` (create)

**Interfaces:**
- Consumes: `ModelDraft`, `Repository`, `checkAgainst`, `toJSON`, `Diagnostic`.
- Produces:
  - `interface FileIO { read(): Promise<string>; write(content: string): Promise<void>; }`
  - `class TodlFileStore` with `save(draft): Promise<void>` and `load(): Promise<{ model: Repository; diagnostics: Diagnostic[] }>`.

- [ ] **Step 1: Write the failing test**

Create `src/authoring/tests/file-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { FrozenRepository } from "../../model/frozen.js";
import { Cardinality } from "../../model/graph.js";
import { toJSON } from "../../emit/json.js";
import { ModelDraft } from "../model-draft.js";
import { TodlFileStore, type FileIO } from "../../index.js";

function baseClient(): FrozenRepository {
  const repo = new Repository();
  const b = repo.builder().setNamespace("acme.ea");
  b.definePrimitive("string");
  b.defineConcept("technology");
  b.addField("technology", "label", "string");
  b.defineConcept("component");
  b.addField("component", "label", "string");
  b.addField("component", "implemented-by", "technology", Cardinality.Optional);
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.commit();
  return FrozenRepository.fromJSON(toJSON(repo));
}

class MemoryFileIO implements FileIO {
  content = "";
  async read(): Promise<string> {
    return this.content;
  }
  async write(content: string): Promise<void> {
    this.content = content;
  }
}

test("save writes .todl; load reparses the model", async () => {
  const base = baseClient();
  const draft = ModelDraft.on([base], { namespace: "acme.app" });
  draft.add({
    concept: "component",
    id: "gw",
    scalars: new Map([["label", "Gateway"]]),
    refs: new Map([["implemented-by", ["copilot"]]]),
  });

  const io = new MemoryFileIO();
  const store = new TodlFileStore(io, [base], { namespace: "acme.app" });
  await store.save(draft);
  assert.match(io.content, /model acme\.app-model : acme\.ea/);

  const { model, diagnostics } = await store.load();
  assert.deepEqual(diagnostics, []);
  assert.equal(model.entity("gw")!.field("label"), "Gateway");
  assert.equal(model.entity("gw")!.ref("implemented-by")!.id, "copilot");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/authoring/tests/file-store.test.ts`
Expected: FAIL — `TodlFileStore`/`FileIO` not exported.

- [ ] **Step 3: Implement `src/authoring/file-store.ts` + exports**

```ts
/**
 * A file-backed model store (design: model emitter + file store). Persists a
 * ModelDraft as `.todl` source through a FileIO seam and reloads it via the
 * parser. TODL owns only the seam — the concrete node:fs / IStorage adapter is a
 * consumer concern, so TODL stays environment-agnostic.
 */

import { Repository } from "../model/model.js";
import { toJSON } from "../emit/json.js";
import { checkAgainst } from "../api.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { ModelDraft } from "./model-draft.js";

/** Read/write the underlying file. Back it with node:fs, Plexus IStorage, etc. */
export interface FileIO {
  read(): Promise<string>;
  write(content: string): Promise<void>;
}

export class TodlFileStore {
  constructor(
    private readonly io: FileIO,
    private readonly bases: readonly Repository[],
    private readonly opts: { namespace: string },
  ) {}

  /** Serialize the draft to `.todl` and write it. */
  async save(draft: ModelDraft): Promise<void> {
    await this.io.write(draft.toTodl());
  }

  /** Read the `.todl` and reparse it against the bases. */
  async load(): Promise<{ model: Repository; diagnostics: Diagnostic[] }> {
    const content = await this.io.read();
    return checkAgainst(
      this.bases.map((b) => toJSON(b)),
      [{ path: `${this.opts.namespace}.todl`, content }],
    );
  }
}
```

In `src/index.ts`, after the `ModelDraft` export, add:

```ts
export { TodlFileStore, type FileIO } from "./authoring/file-store.js";
export { deriveBindings, emitModelTodl, type ModelBindings } from "./emit/todl.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/authoring/tests/file-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck + build**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`, then `npm run typecheck`, then `npm run build`
Expected: whole suite green; typecheck clean; build exits 0 and emits `dist/emit/todl.js` + `dist/authoring/file-store.js`.

- [ ] **Step 6: Commit**

```bash
git add src/authoring/file-store.ts src/index.ts src/authoring/tests/file-store.test.ts
git commit -m "feat(authoring): TodlFileStore + FileIO seam — save/load a model as .todl (complete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done-when

- `ModelDraft.toTodl()` emits the own model as `.todl` that round-trips through `checkAgainst` with zero diagnostics.
- `TodlFileStore` saves a draft as `.todl` and loads it back through a `FileIO` seam, fake-tested end-to-end.
- Emitter + file store + `FileIO` exported; whole suite green, typecheck clean, build emits the new modules.
- Additive; no existing behaviour changed; no new dependency.
- Deferred (documented): re-opening a loaded `.todl` as an editable `ModelDraft`; a concrete `node:fs`/`IStorage` `FileIO` adapter; Plexus delegating its emitter to this one; the Dgraph backend.
