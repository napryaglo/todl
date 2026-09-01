# TODL File-Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the loader record `nodeId → source-uri` for every own node (named instances *and* loader-minted reified edges / inline objects), surface it through `load`/`check`/`checkAgainst`, and have `ModelDraft.fromSources` home every own id from it — so `toTodlByFile()` writes each entity back to the file it was read from.

**Architecture:** A first-wins `HomeRecorder` (`{ current, map }`) is threaded through the loader's third (instance) materialization pass. Every own node is created through `applyInstance` or `applyModel` — including minted reified edges and inline objects, which synthesize an `InstanceDecl` and route through `applyInstance` — so recording at those two chokepoints captures all of them. The recorder's `current` uri is set from each unit before it materializes. `loadInto` fills an optional provenance map; `load`/`check`/`checkAgainst` expose it; `fromSources` consumes it and drops its re-parse heuristic.

**Tech Stack:** TypeScript (ESM, strict), `@pragmatic-tech-ai/todl`. Tests are `node:test` + `node:assert/strict`, run with `tsx --conditions=development --test "src/**/*.test.ts"`.

## Global Constraints

- Additive only: `check` / `checkAgainst` / `load` / `loadInto` gain optional params / return fields; no existing caller breaks (all destructure `{ model, diagnostics }`).
- Provenance is **first-wins** (`!map.has(id)`) and scoped to own (source-loaded) nodes; base nodes (from `mergeBases`) are never recorded.
- Every test file lives in a `tests/` subfolder next to the source it exercises.
- Enums over string-literal unions (project rule; no new string-literal unions).
- Run the full suite with `npx tsx --conditions=development --test "src/**/*.test.ts"`.
- Publish TODL only to local Verdaccio (`localhost:4873`), never public npm — and only when the user asks.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `src/parse/loader.ts` — add `HomeRecorder` + `recordHome`; thread `rec?` through the third-pass materialization helpers; record at `applyInstance`/`applyModel`; add `provenance?` out-param to `loadInto`; return `provenance` from `load`; add `provenance` to `LoadResult`; add `uri` to the deferred-composition / deferred-term-value structs and the Pass-1 + third-pass unit loops.
- `src/api.ts` — `checkAgainst` allocates the provenance map, passes it to `loadInto`, returns it; `check` propagates it (return-type annotations updated).
- `src/authoring/model-draft.ts` — `fromSources` consumes `result.provenance`; delete the re-parse block; drop the now-unused `parse` / `collectDefinitions` imports.
- `src/parse/tests/provenance.test.ts` — NEW: loader-level provenance (named + minted, per-file).
- `src/tests/provenance.test.ts` — NEW: `checkAgainst` surfaces provenance for a minted reified edge.
- `src/authoring/tests/model-draft-provenance.test.ts` — NEW: `fromSources`/`toTodlByFile` round-trip keeps reified edges and inline objects in their origin file.

---

## Task 1: Loader records provenance for every own node

**Files:**
- Modify: `src/parse/loader.ts`
- Test: `src/parse/tests/provenance.test.ts`

**Interfaces:**
- Consumes: existing `load(sources, idGenerator?)`, `applyInstance`, `applyModel`, `mintReifiedEdge`, `realizeInlineObject`, `FakeIdGenerator` (`src/model/tests/fake-id-generator.js`, mints `id-0`, `id-1`, …).
- Produces:
  - `interface HomeRecorder { current: string | null; readonly map: Map<string, string> }`
  - `function recordHome(rec: HomeRecorder | undefined, id: string): void` — first-wins.
  - `interface LoadResult { model: Repository; diagnostics: Diagnostic[]; provenance: Map<string, string> }`
  - `loadInto(model, sources, reserved?, idGenerator?, provenance?: Map<string,string>): Diagnostic[]` — fills `provenance` in place when supplied.
  - `load(sources, idGenerator?): LoadResult` — returns a populated `provenance`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/provenance.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";

// A meta-model + model authored across two files: the endpoints live in
// structure.todl, the reified `a ~> b` connector is authored in flow.todl.
const structure = { uri: "structure.todl", text: `namespace t {
  concept endpoint { label : string; }
  concept connector { from : endpoint; to : endpoint; }
  operator ~> : connector (from, to);
  model M : t { endpoint a {} endpoint b {} }
}` };
const flow = { uri: "flow.todl", text: `namespace t {
  model M : t { a ~> b; }
}` };

test("load records the origin file of every own node — named and minted", () => {
  const { provenance } = load([structure, flow], new FakeIdGenerator());
  assert.equal(provenance.get("a"), "structure.todl");   // named instance
  assert.equal(provenance.get("b"), "structure.todl");
  assert.equal(provenance.get("id-0"), "flow.todl");     // minted connector homed to flow.todl, NOT structure
});

test("a single-file load homes named and minted ids to that file", () => {
  const src = { uri: "one.todl", text: `namespace t {
    concept endpoint { label : string; }
    concept connector { from : endpoint; to : endpoint; }
    operator ~> : connector (from, to);
    model M : t { endpoint a {} endpoint b {} a ~> b; }
  }` };
  const { provenance } = load([src], new FakeIdGenerator());
  assert.equal(provenance.get("a"), "one.todl");
  assert.equal(provenance.get("id-0"), "one.todl");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/provenance.test.ts`
Expected: FAIL — `provenance` is `undefined` on the `load` result (property does not exist yet), so `provenance.get` throws.

- [ ] **Step 3: Add the recorder type, helper, and `LoadResult.provenance`**

In `src/parse/loader.ts`, replace the existing `LoadResult` interface (around line 41):

```ts
export interface LoadResult {
  model: Repository;
  diagnostics: Diagnostic[];
  provenance: Map<string, string>;
}

// Records nodeId → source-uri as own nodes are materialised. First-wins: a node
// is homed to the first file that creates it. `current` is set from each unit
// before it is materialised; undefined recorder = caller doesn't want provenance.
interface HomeRecorder {
  current: string | null;
  readonly map: Map<string, string>;
}

function recordHome(rec: HomeRecorder | undefined, id: string): void {
  if (rec !== undefined && rec.current !== null && !rec.map.has(id)) rec.map.set(id, rec.current);
}
```

- [ ] **Step 4: Wire `provenance` through `load` and `loadInto`**

Replace `load` (around line 68):

```ts
export function load(sources: SourceFile[], idGenerator: IdGenerator = new SnowflakeIdGenerator()): LoadResult {
  const model = new Repository();
  const provenance = new Map<string, string>();
  const diagnostics = loadInto(model, sources, new Set(), idGenerator, provenance);
  return { model, diagnostics, provenance };
}
```

Change the `loadInto` signature (around line 78) to add the trailing optional out-param:

```ts
export function loadInto(
  model: Repository,
  sources: SourceFile[],
  reserved: ReadonlySet<string> = new Set(),
  idGenerator: IdGenerator = new SnowflakeIdGenerator(),
  provenance?: Map<string, string>,
): Diagnostic[] {
```

Immediately after `const diagnostics: Diagnostic[] = [];` (the first line of the body, ~line 84), add:

```ts
  const rec: HomeRecorder | undefined = provenance !== undefined ? { current: null, map: provenance } : undefined;
```

- [ ] **Step 5: Carry `uri` on the deferred structs and the unit loops**

Add `uri` to the two deferred struct declarations (around lines 302 and 306):

```ts
  const deferredCompositions: { ns: string; uri: string; parentId: string; parentConcept: string; decl: InstanceDecl }[] = [];
```
```ts
  const deferredTermValues: { ns: string; uri: string; concept: string; termId: string; name: string; value: ValueNode }[] = [];
```

In the Pass-1 loop header (around line 313) destructure `uri`:

```ts
  for (const { ns, uri, decl: declaration } of units) {
```

At the `deferredCompositions.push({` site (around line 349) add `uri,` and at the `deferredTermValues.push({` site (around line 372) add `uri,`:

```ts
              deferredCompositions.push({
                ns,
                uri,
                parentId: `${decl.name}.${t.id}`,
                parentConcept: ownConcept,
                decl: termToInstanceDecl(decl.name, child),
              });
```
```ts
              deferredTermValues.push({ ns, uri, concept: ownConcept, termId: `${decl.name}.${t.id}`, name: assignment.name, value: v });
```

In the third-pass unit loop (around line 455), destructure `uri`, set `rec.current`, and pass `rec` to both applies:

```ts
  for (const { ns, uri, decl: declaration } of units) {
    third.setNamespace(ns);
    if (rec !== undefined) rec.current = uri;
    if (declaration.kind === DeclKind.Instance) {
      applyInstance(third, model, declaration, null, null, asserted, diagnostics, idGenerator, ops, rec);
    } else if (declaration.kind === DeclKind.Model) {
      applyModel(third, model, declaration, asserted, diagnostics, idGenerator, ops, rec);
    }
  }
```

In the deferred-compositions loop (around line 465) and deferred-term-values loop (around line 470), set `rec.current` and pass `rec`:

```ts
  for (const composition of deferredCompositions) {
    third.setNamespace(composition.ns);
    if (rec !== undefined) rec.current = composition.uri;
    applyInstance(third, model, composition.decl, composition.parentId, composition.parentConcept, asserted, diagnostics, idGenerator, ops, rec);
  }
  for (const d of deferredTermValues) {
    third.setNamespace(d.ns);
    if (rec !== undefined) rec.current = d.uri;
    realizeValue(third, model, d.concept, d.termId, d.name, d.value, diagnostics, asserted, idGenerator, ops, rec);
  }
```

- [ ] **Step 6: Thread `rec?` through the materialization helpers and record at the two chokepoints**

Add a trailing `rec?: HomeRecorder` parameter to each of these functions and forward it at every internal call. Record ids only in `applyInstance` and `applyModel`.

`applyModel` (around line 732) — add param, record the container id, forward to `applyInstance` and `applyEdges`:

```ts
function applyModel(
  builder: Builder,
  model: Repository,
  decl: ModelDecl,
  asserted: Set<string>,
  diagnostics: Diagnostic[],
  idGen: IdGenerator,
  ops: OperatorTable,
  rec?: HomeRecorder,
): void {
  if (!asserted.has(decl.id)) {
    builder.assertModel(decl.id);
    recordHome(rec, decl.id);
    builder.setField(decl.id, "id", decl.id);
    // … unchanged …
  }
  for (const child of decl.instances) {
    applyInstance(builder, model, child, decl.id, null, asserted, diagnostics, idGen, ops, rec);
    // … unchanged conforms stamping …
  }
  applyEdges(builder, model, decl.edges, decl.id, ops, asserted, diagnostics, idGen, rec);
}
```

`applyInstance` (around line 765) — add param, record the id in the `first` block, forward to the wrapper recursion, child recursion, `realizeValue`, and `applyEdges`:

```ts
function applyInstance(
  builder: Builder,
  model: Repository,
  decl: InstanceDecl,
  parent: string | null,
  parentConcept: string | null,
  asserted: Set<string>,
  diagnostics: Diagnostic[],
  idGen: IdGenerator,
  ops: OperatorTable,
  rec?: HomeRecorder,
): void {
  if (WRAPPER_CONCEPTS.has(decl.concept)) {
    for (const child of decl.children) applyInstance(builder, model, child, null, null, asserted, diagnostics, idGen, ops, rec);
    return;
  }
  const first = !asserted.has(decl.id);
  if (first) {
    asserted.add(decl.id);
    builder.assertInstance(decl.concept, decl.id, decl.isClass);
    recordHome(rec, decl.id);
    // … unchanged field/parent wiring …
  }
  for (const assignment of decl.assignments) {
    realizeValue(builder, model, decl.concept, decl.id, assignment.name, assignment.value, diagnostics, asserted, idGen, ops, rec);
  }
  for (const child of decl.children) {
    applyInstance(builder, model, child, decl.id, decl.concept, asserted, diagnostics, idGen, ops, rec);
  }
  applyEdges(builder, model, decl.edges, decl.id, ops, asserted, diagnostics, idGen, rec);
}
```

`realizeValue` (around line 847) — add param; forward to its list recursion, `realizeInlineObject`, `realizeEdgeValue`:

```ts
function realizeValue(
  builder: Builder,
  model: Repository,
  concept: string,
  id: string,
  name: string,
  value: ValueNode,
  diagnostics: Diagnostic[],
  asserted: Set<string>,
  idGen: IdGenerator,
  ops: OperatorTable,
  rec?: HomeRecorder,
): void {
  // … unchanged switch head …
    case ValueKind.List:
      for (const item of value.items) realizeValue(builder, model, concept, id, name, item, diagnostics, asserted, idGen, ops, rec);
      break;
    case ValueKind.Object:
      realizeInlineObject(builder, model, concept, id, name, value, diagnostics, asserted, idGen, ops, rec);
      break;
    case ValueKind.Edge:
      realizeEdgeValue(builder, model, concept, id, name, value.edge, diagnostics, asserted, idGen, ops, rec);
      break;
  // … unchanged tail …
}
```

`realizeInlineObject` (around line 910) — add param; forward to `applyInstance` (the synth carries the minted `objId`, which `applyInstance` records):

```ts
function realizeInlineObject(
  builder: Builder,
  model: Repository,
  ownerConcept: string,
  owner: string,
  field: string,
  value: ObjectValue,
  diagnostics: Diagnostic[],
  asserted: Set<string>,
  idGen: IdGenerator,
  ops: OperatorTable,
  rec?: HomeRecorder,
): void {
  // … unchanged guards + synth build …
  applyInstance(builder, model, synth, null, null, asserted, diagnostics, idGen, ops, rec);
  builder.addContains(owner, objId);
  builder.addRelationship(owner, field, objId);
}
```

`applyEdges` (around line 1059) and `applyEdge` (around line 1069) — add param; forward:

```ts
function applyEdges(
  builder: Builder, model: Repository, edges: readonly EdgeApplication[], ownerId: string | null,
  ops: OperatorTable, asserted: Set<string>, diagnostics: Diagnostic[], idGen: IdGenerator, rec?: HomeRecorder,
): void {
  for (const edge of edges) applyEdge(builder, model, edge, ownerId, ops, asserted, diagnostics, idGen, rec);
}
```
```ts
function applyEdge(
  builder: Builder, model: Repository, edge: EdgeApplication, ownerId: string | null,
  ops: OperatorTable, asserted: Set<string>, diagnostics: Diagnostic[], idGen: IdGenerator, rec?: HomeRecorder,
): void {
  // … unchanged undefined-glyph + relationship-form branches …
  mintReifiedEdge(builder, model, edge, op, ownerId, asserted, diagnostics, idGen, ops, rec);
}
```

`mintReifiedEdge` (around line 1102) — add param; forward to `applyInstance` (records the minted `objId`):

```ts
function mintReifiedEdge(
  builder: Builder, model: Repository, edge: EdgeApplication, op: ResolvedOperator, ownerId: string | null,
  asserted: Set<string>, diagnostics: Diagnostic[], idGen: IdGenerator, ops: OperatorTable, rec?: HomeRecorder,
): string {
  // … unchanged synth build …
  applyInstance(builder, model, synth, ownerId, null, asserted, diagnostics, idGen, ops, rec);
  return objId;
}
```

`realizeEdgeValue` (around line 1123) — add param; forward to `mintReifiedEdge`:

```ts
function realizeEdgeValue(
  builder: Builder, model: Repository, ownerConcept: string, owner: string, field: string,
  edge: EdgeApplication, diagnostics: Diagnostic[], asserted: Set<string>, idGen: IdGenerator, ops: OperatorTable, rec?: HomeRecorder,
): void {
  // … unchanged guards …
  const id = mintReifiedEdge(builder, model, edge, op, owner, asserted, diagnostics, idGen, ops, rec);
  builder.addRelationship(owner, field, id);
}
```

- [ ] **Step 7: Run the provenance test to verify it passes**

Run: `npx tsx --conditions=development --test src/parse/tests/provenance.test.ts`
Expected: PASS (both tests).

- [ ] **Step 8: Run the full loader test suite (no regressions)**

Run: `npx tsx --conditions=development --test "src/parse/tests/*.test.ts"`
Expected: all pass. `load` callers now receive an extra `provenance` field (additive) and are unaffected.

- [ ] **Step 9: Commit**

```bash
git add src/parse/loader.ts src/parse/tests/provenance.test.ts
git commit -m "$(cat <<'EOF'
feat(loader): record source-file provenance for own nodes

Thread a first-wins HomeRecorder through the instance materialization pass;
applyInstance/applyModel record each own id (named + minted reified edges and
inline objects route through applyInstance) against the current unit's uri.
loadInto fills an optional provenance map; load returns it on LoadResult.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Surface provenance through `check` / `checkAgainst`

**Files:**
- Modify: `src/api.ts`
- Test: `src/tests/provenance.test.ts`

**Interfaces:**
- Consumes: `loadInto(model, sources, reserved?, idGenerator?, provenance?)` from Task 1.
- Produces:
  - `checkAgainst(bases, sources, idGenerator?): { model: Repository; diagnostics: Diagnostic[]; provenance: Map<string, string> }`
  - `check(sources, idGenerator?): { model: Repository; diagnostics: Diagnostic[]; provenance: Map<string, string> }`

- [ ] **Step 1: Write the failing test**

Create `src/tests/provenance.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { check, checkAgainst } from "../api.js";
import { toJSON } from "../emit/json.js";

// Meta-model with a reified `~>` connector; an arch model authors `a ~> b`.
const meta = { uri: "mm.todl", text: `namespace mm {
  concept endpoint { label : string; }
  concept connector { from : endpoint; to : endpoint; }
  operator ~> : connector (from, to);
  viewpoint Flow : frames connector
}` };

test("checkAgainst surfaces the origin file of a minted reified edge", () => {
  const base = toJSON(check([meta]).model);
  const src = { uri: "flow.todl", text: `namespace acme {
    import mm;
    model Arch : mm conforms Flow { endpoint a {} endpoint b {} a ~> b; }
  }` };
  const { model, provenance } = checkAgainst([base], [src]);
  // The minted connector is the sole own node of typeOf "connector".
  const connector = model.allNodes().find((n) => n.typeOf === "connector");
  assert.ok(connector, "a connector node was minted");
  assert.equal(provenance.get(connector.id), "flow.todl");
});

test("check returns a provenance map for named instances", () => {
  const { provenance } = check([{ uri: "one.todl", text: `namespace t {
    concept box {}
    model M : t { box a {} }
  }` }]);
  assert.equal(provenance.get("a"), "one.todl");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/tests/provenance.test.ts`
Expected: FAIL — `provenance` is `undefined` on the `checkAgainst` / `check` result.

- [ ] **Step 3: Return provenance from `checkAgainst` and `check`**

In `src/api.ts`, update `check` (around line 16) — only its return-type annotation changes; it already returns `checkAgainst(...)`:

```ts
export function check(sources: SourceFile[], idGenerator?: IdGenerator): { model: Repository; diagnostics: Diagnostic[]; provenance: Map<string, string> } {
  return checkAgainst([], sources, idGenerator);
}
```

Update `checkAgainst` (around line 26):

```ts
export function checkAgainst(
  bases: TodlDocument[],
  sources: SourceFile[],
  idGenerator: IdGenerator = new SnowflakeIdGenerator(),
): { model: Repository; diagnostics: Diagnostic[]; provenance: Map<string, string> } {
  const model = new Repository(mergeBases([preludeDocument(), ...bases]));
  const provenance = new Map<string, string>();
  const diagnostics = loadInto(model, sources, preludeNames(), idGenerator, provenance);
  return { model, diagnostics: [...diagnostics, ...validate(model)], provenance };
}
```

- [ ] **Step 4: Run the provenance test to verify it passes**

Run: `npx tsx --conditions=development --test src/tests/provenance.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Run the api test suite (no regressions)**

Run: `npx tsx --conditions=development --test "src/tests/*.test.ts"`
Expected: all pass (`check.test.ts`, `check-against.test.ts`, etc. destructure `{ model, diagnostics }` — the added field is additive).

- [ ] **Step 6: Commit**

```bash
git add src/api.ts src/tests/provenance.test.ts
git commit -m "$(cat <<'EOF'
feat(api): expose load-time provenance from check/checkAgainst

Both allocate the provenance map, pass it to loadInto, and return it — additive
to the existing { model, diagnostics } result.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `ModelDraft.fromSources` homes every own id from provenance

**Files:**
- Modify: `src/authoring/model-draft.ts:76-98` (`fromSources` body) and the imports at `src/authoring/model-draft.ts:18-19`
- Test: `src/authoring/tests/model-draft-provenance.test.ts`

**Interfaces:**
- Consumes: `checkAgainst(bases, sources, idGenerator?)` returning `{ model, diagnostics, provenance }` (Task 2); existing `draft.home`, `draft.own`, `draft.homeOf`, `draft.toTodlByFile`, `draft.ownInstances`.
- Produces: `fromSources` populates `draft.home` for **every** own id (named + minted) from `result.provenance`.

- [ ] **Step 1: Write the failing test**

Create `src/authoring/tests/model-draft-provenance.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { ModelDraft } from "../model-draft.js";

// Meta-model: endpoints framed by Structure, reified connectors by Flow.
function base() {
  return check([{ uri: "mm.todl", text: `namespace mm {
    concept endpoint { label : string; }
    concept connector { from : endpoint; to : endpoint; }
    operator ~> : connector (from, to);
    viewpoint Structure : frames endpoint
    viewpoint Flow : frames connector
  }` }]).model;
}

const structure = { uri: "structure.todl", text: `namespace acme {
  import mm;
  model Arch : mm conforms Structure { endpoint a {} endpoint b {} }
}` };
const flow = { uri: "flow.todl", text: `namespace acme {
  import mm;
  model Arch : mm conforms Flow { a ~> b; }
}` };

test("a minted reified edge is homed to the file that authored it", () => {
  const draft = ModelDraft.fromSources([base()], [structure, flow], { namespace: "acme" });
  const connector = draft.ownInstances().find((e) => e.typeOf === "connector");
  assert.ok(connector, "connector materialised");
  assert.equal(draft.homeOf(connector.id), "flow.todl");
});

test("toTodlByFile keeps the reified edge in its origin file — no default-file spill", () => {
  const draft = ModelDraft.fromSources([base()], [structure, flow], { namespace: "acme" });
  const files = draft.toTodlByFile();
  // The step stays in flow.todl; NO stray acme.todl default file is created.
  assert.deepEqual([...files.keys()].sort(), ["flow.todl", "structure.todl"]);
  assert.match(files.get("flow.todl")!, /~>/);
  assert.match(files.get("structure.todl")!, /endpoint a/);
});

test("an inline object is homed to the file that authored it", () => {
  const inlineBase = check([{ uri: "mm.todl", text: `namespace mm {
    concept endpoint { label : string; }
    concept box { body : endpoint; }
    viewpoint V : frames box
  }` }]).model;
  const inline = { uri: "inline.todl", text: `namespace acme {
    import mm;
    model Arch : mm conforms V { box outer { body = endpoint {} } }
  }` };
  const draft = ModelDraft.fromSources([inlineBase], [inline], { namespace: "acme" });
  const files = draft.toTodlByFile();
  // Everything (outer + its minted inline endpoint) stays in inline.todl.
  assert.deepEqual([...files.keys()], ["inline.todl"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/authoring/tests/model-draft-provenance.test.ts`
Expected: FAIL — the minted connector has no home, so `homeOf` is `undefined` and `toTodlByFile` emits it to the default `acme.todl` (keys become `["acme.todl", "structure.todl"]`; the inline case gains a stray `acme.todl`).

- [ ] **Step 3: Consume provenance in `fromSources`**

In `src/authoring/model-draft.ts`, replace the body of `fromSources` (lines 76-98) — swap the `checkAgainst` call to keep its `provenance`, and replace the re-parse block:

```ts
  static fromSources(
    bases: readonly Repository[],
    sources: readonly { uri: string; text: string }[],
    opts: { namespace: string },
  ): ModelDraft {
    const draft = new ModelDraft([preludeDocument(), ...bases.map((b) => toJSON(b))], opts.namespace);
    const result = checkAgainst([...draft.baseDocs], sources.map((s) => ({ uri: s.uri, text: s.text })));
    const compiled = toJSON(result.model);
    const modelIds = new Set(compiled.nodes.filter((n) => n.typeOf === MODEL_TYPEOF).map((n) => n.id));
    draft.own = {
      nodes: compiled.nodes.filter((n) => !draft.baseIds.has(n.id) && !modelIds.has(n.id)),
      edges: compiled.edges.filter((e) => !draft.baseIds.has(String(e.from)) && !modelIds.has(String(e.from))),
    };
    // Home every own id from the loader's authoritative provenance (covers named
    // instances AND loader-minted reified edges / inline objects). The model
    // container id is skipped since it is not an own node.
    const ownIds = new Set(draft.own.nodes.map((n) => n.id));
    for (const [id, uri] of result.provenance) if (ownIds.has(id)) draft.home.set(id, uri);
    return draft;
  }
```

- [ ] **Step 4: Drop the now-unused imports**

In `src/authoring/model-draft.ts`, remove the two imports that only the deleted re-parse block used (lines 18-19):

```ts
import { parse } from "../parse/parser.js";
import { collectDefinitions } from "../parse/references.js";
```

- [ ] **Step 5: Run the provenance round-trip test to verify it passes**

Run: `npx tsx --conditions=development --test src/authoring/tests/model-draft-provenance.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 6: Run the authoring suite (multifile regression)**

Run: `npx tsx --conditions=development --test "src/authoring/tests/*.test.ts"`
Expected: all pass — in particular `model-draft-multifile.test.ts` (named instances still home to their file, now sourced from provenance rather than the re-parse).

- [ ] **Step 7: Typecheck (unused-import + signature check)**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `parse`/`collectDefinitions` were the only users of those imports and every threaded signature is consistent).

- [ ] **Step 8: Run the whole suite**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/authoring/model-draft.ts src/authoring/tests/model-draft-provenance.test.ts
git commit -m "$(cat <<'EOF'
feat(authoring): home every own id from loader provenance

fromSources consumes checkAgainst's provenance to home named AND minted ids
(reified edges, inline objects), replacing the re-parse/collectDefinitions
heuristic that left minted ids homeless — so toTodlByFile writes each entity
back to its origin file instead of spilling to the default namespace file.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Rollout (post-merge, when the user asks)

Not implementation tasks — the finishing step. After the branch merges to TODL main:
1. Bump `@pragmatic-tech-ai/todl` version and republish to **local Verdaccio** (`localhost:4873`).
2. Bump Plexus's `@pragmatic-tech-ai/todl` dependency to the new version.

Plexus needs **no code change** — `ArchModel.save()` already routes through `toTodlByFile()`; once TODL homes minted ids, saves land in the correct file automatically.

---

## Self-Review

**Spec coverage:**
- Loader records provenance for named + minted own nodes (spec §Components 1) → Task 1.
- `LoadResult.provenance` + `loadInto` out-param (spec §Components 2) → Task 1.
- `check`/`checkAgainst` surface provenance (spec §Components 3) → Task 2.
- `fromSources` consumes it, re-parse block deleted (spec §Components 4) → Task 3.
- Deferred compositions/term-values carry uri (spec §Components 1) → Task 1 Step 5.
- Testing: reified-edge round-trip, inline-object, named regression, loader unit (spec §Testing) → Task 1 (loader unit), Task 2 (checkAgainst), Task 3 (round-trip + inline + regression).
- Rollout (spec §Rollout) → Rollout section.
- Additive-only / first-wins / base-never-homed (spec §Constraints) → Global Constraints; `recordHome` first-wins; provenance scoped to loaded sources.

**Placeholder scan:** none — every code step carries the actual code; the `// … unchanged …` markers in Task 1 Step 6 delimit forwarding edits within otherwise-unchanged bodies, with the concrete added params/calls shown.

**Type consistency:** `HomeRecorder`, `recordHome`, `rec?: HomeRecorder`, `provenance?: Map<string, string>`, and the `{ model, diagnostics, provenance }` return shape are used identically across Tasks 1–3. `FakeIdGenerator` mints `id-0` (matches existing `edge-value-load.test.ts` / `operator-load.test.ts`). Meta-model concept names (`endpoint`/`connector`/`box`) and viewpoints (`Structure`/`Flow`/`V`) are consistent within each test.
