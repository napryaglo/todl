# Mutable ModelDraft + ArchInstanceModel Collapse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Make TODL's `ModelDraft` delta-based + mutable (`create`/`setField`/`addRef`/`removeRef`/`remove` + `fromSource` + `referenceMembers`), then slim Plexus's `ArchInstanceModel` to a wrapper that keeps only `freshId` + `onChanged`.

**Architecture:** `ModelDraft` holds a mutable own `TodlDocument` over frozen base docs and derives the combined `Repository` lazily (cache invalidated on mutation) — the proven `ArchInstanceModel` structure, lifted into TODL. Public reads and `add`'s fail-fast contract are preserved.

**Tech Stack:** TypeScript ESM; TODL node:test; Plexus vitest; Verdaccio.

**Spec:** `docs/superpowers/specs/2026-08-06-modeldraft-mutation-design.md`.

## Global Constraints

- Verdaccio `http://localhost:4873/`. TODL `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- Tests in `tests/` subfolders. Real enums. `SourceFile` = `{ uri, text }`.
- Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; commit only when asked (this run: authorized).
- TODL: test `npx tsx --conditions=development --test "src/**/*.test.ts"`; typecheck `npm run typecheck`; build `npm run build`. Plexus: `npx vitest run`.
- **Backward-compat gate:** existing `model-draft.test.ts`, `model-draft-serialize.test.ts`, `file-store.test.ts` MUST stay green through every TODL task.

## File Structure

- `TODL/src/authoring/model-draft.ts` — delta refactor + mutators + `fromSource` + `referenceMembers`.
- `TODL/src/authoring/tests/model-draft-mutation.test.ts` — new mutation/fromSource/referenceMembers tests.
- `TODL/package.json`, `src/index.ts` — version + (no new exports; methods hang off the already-exported `ModelDraft`; `FieldSchema` already exported).
- `Plexus/.../architecture-instance-model.ts` — slim to wrapper.

---

### Task 1: `ModelDraft` goes delta-based (internal refactor, behavior-preserving)

**Files:** Modify `src/authoring/model-draft.ts`. Gate: existing tests.

- [ ] **Step 1: Run the existing suites to confirm green baseline**

Run: `npx tsx --conditions=development --test "src/authoring/tests/*.test.ts"` → all pass.

- [ ] **Step 2: Refactor internals to own-delta + lazy model**

Replace the constructor/state and `on()`; keep every public method's behavior. Key shape (mirrors `ArchInstanceModel`):

```ts
import { graphFromJSON } from "../emit/json.js";
import { fromJSON } from "../emit/json.js"; // if not already: build Repository from a TodlDocument
// ...
export class ModelDraft {
  private own: TodlDocument = { nodes: [], edges: [] };
  private modelCache?: Repository;
  private constructor(
    private readonly baseDocs: readonly TodlDocument[], // [preludeDocument(), ...bases]
    readonly namespace: string,
  ) {
    this.baseIds = new Set(baseDocs.flatMap((d) => d.nodes.map((n) => n.id)));
  }
  private readonly baseIds: ReadonlySet<NodeId>;

  static on(bases: readonly Repository[], opts: { namespace: string }): ModelDraft {
    return new ModelDraft([preludeDocument(), ...bases.map((b) => toJSON(b))], opts.namespace);
  }

  get model(): Repository {
    if (this.modelCache === undefined) {
      const nodes = new Map<NodeId, TodlDocument["nodes"][number]>();
      for (const n of [...this.baseDocs.flatMap((d) => d.nodes), ...this.own.nodes]) nodes.set(n.id, n);
      const edges = new Map<string, TodlDocument["edges"][number]>();
      for (const e of [...this.baseDocs.flatMap((d) => d.edges), ...this.own.edges])
        edges.set(`${e.kind}|${e.from}|${e.to}|${e.via}`, e);
      this.modelCache = fromJSON({ nodes: [...nodes.values()], edges: [...edges.values()] });
    }
    return this.modelCache;
  }
  private invalidate(): void { this.modelCache = undefined; }
  // resolve/has/entity/ownInstances/diagnostics now read `this.model`.
  // toJSON() returns this.own (deep enough copy for safety); toTodl() unchanged over this.own.
}
```

`add(descriptor)` re-expressed over the delta, preserving fail-fast:

```ts
add(descriptor: InstanceDescriptor): Entity {
  this.create(descriptor.concept, descriptor.id);
  for (const [name, value] of descriptor.scalars ?? []) this.setField(descriptor.id, name, value);
  for (const [member, targets] of descriptor.refs ?? [])
    for (const target of targets) this.addRef(descriptor.id, member, target); // throws on missing target
  return this.model.entity(descriptor.id)!;
}
```

(Provide `create`/`setField`/`addRef` now — Task 2 adds their tests; here they must at least exist for `add`.)

- [ ] **Step 3: Run existing suites — all green (no behavior change)**

Run: `npx tsx --conditions=development --test "src/authoring/tests/*.test.ts"` then `npm run typecheck`.
Expected: PASS, including "add throws when a reference target does not exist."

- [ ] **Step 4: Commit** — `feat(authoring): ModelDraft goes delta-based (behavior-preserving)`.

---

### Task 2: Mutation API + tests

**Files:** Modify `model-draft.ts`; Create `src/authoring/tests/model-draft-mutation.test.ts`.

**Interfaces (produced):**
- `create(concept: string, id: NodeId): Entity`
- `setField(id: NodeId, name: string, value: Scalar): void`
- `addRef(from: NodeId, member: string, to: NodeId): void`
- `removeRef(from: NodeId, member: string, to: NodeId): void`
- `remove(id: NodeId): void`

- [ ] **Step 1: Write failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { ModelDraft } from "../model-draft.js";

function base(): Repository {
  const r = new Repository();
  const b = r.builder().setNamespace("ea");
  b.definePrimitive("string"); b.defineConcept("technology"); b.defineConcept("component");
  b.addField("component", "label", "string"); b.addField("component", "impl", "technology");
  b.commit();
  return r;
}

test("create + setField + addRef/removeRef + remove mutate the overlay", () => {
  const d = ModelDraft.on([base()], { namespace: "app" });
  d.create("technology", "t1");
  d.create("component", "gw");
  d.setField("gw", "label", "Gateway");
  assert.equal(d.entity("gw")!.field("label"), "Gateway");
  d.addRef("gw", "impl", "t1");
  assert.deepEqual(d.entity("gw")!.refs("impl").map((e) => e.id), ["t1"]);
  d.removeRef("gw", "impl", "t1");
  assert.deepEqual(d.entity("gw")!.refs("impl"), []);
  d.remove("t1");
  assert.equal(d.has("t1"), false);
  assert.deepEqual(d.ownInstances().map((e) => e.id).sort(), ["gw"]);
});

test("addRef to a missing target throws; setField on a base id throws", () => {
  const d = ModelDraft.on([base()], { namespace: "app" });
  d.create("component", "gw");
  assert.throws(() => d.addRef("gw", "impl", "ghost"));
  assert.throws(() => d.setField("component", "label", "x")); // base id, frozen
});
```

- [ ] **Step 2: Run — FAIL** (methods missing / behavior).
- [ ] **Step 3: Implement** the five mutators over `this.own` (push/filter arrays), each calling `invalidate()`; `addRef`/`create` validate targets exist in `baseIds ∪ ownIds` (throw otherwise); `setField`/`remove` throw if `id` is a base id.
- [ ] **Step 4: Run — PASS**, plus rerun existing suites green.
- [ ] **Step 5: Commit** — `feat(authoring): ModelDraft mutation API (create/setField/addRef/removeRef/remove)`.

---

### Task 3: `fromSource` (editable reopen)

**Files:** Modify `model-draft.ts`; extend the mutation test file.

**Interface:** `static fromSource(bases: readonly Repository[], source: string, opts: { namespace: string }): ModelDraft`.

- [ ] **Step 1: Failing test**

```ts
test("fromSource reopens a saved model as an editable draft (round-trip)", () => {
  const d1 = ModelDraft.on([base()], { namespace: "app" });
  d1.create("component", "gw"); d1.setField("gw", "label", "Gateway");
  const src = d1.toTodl();
  const d2 = ModelDraft.fromSource([base()], src, { namespace: "app" });
  assert.deepEqual(d2.ownInstances().map((e) => e.id), ["gw"]);
  assert.equal(d2.entity("gw")!.field("label"), "Gateway");
  assert.deepEqual(d2.diagnostics, []);
  d2.setField("gw", "label", "GW2"); // still editable
  assert.equal(d2.entity("gw")!.field("label"), "GW2");
});
test("fromSource of blank source yields an empty draft", () => {
  assert.deepEqual(ModelDraft.fromSource([base()], "  ", { namespace: "app" }).ownInstances(), []);
});
```

- [ ] **Step 2: Run — FAIL**.
- [ ] **Step 3: Implement** — compile `checkAgainst(this baseDocs, [{ uri: `${namespace}.todl`, text: source }])`, take non-base nodes/edges, strip the `typeOf === "model"` container node + its `Contains` edges, seed `own`. Blank source → empty. (Reuse the private base-doc construction from `on()`.)
- [ ] **Step 4: Run — PASS** + existing green.
- [ ] **Step 5: Commit** — `feat(authoring): ModelDraft.fromSource — reopen .todl as an editable draft`.

---

### Task 4: `referenceMembers` schema helper

**Files:** Modify `model-draft.ts`; extend test file. Import `FieldSchema` from `../model/model.js`.

**Interface:** `referenceMembers(fromId: NodeId, toId: NodeId): FieldSchema[]`.

- [ ] **Step 1: Failing test**

```ts
test("referenceMembers returns concept-typed fields a target can fill", () => {
  const d = ModelDraft.on([base()], { namespace: "app" });
  d.create("component", "gw"); d.create("technology", "t1");
  const members = d.referenceMembers("gw", "t1").map((f) => f.name);
  assert.deepEqual(members, ["impl"]); // "label" (string) excluded
});
```

- [ ] **Step 2: Run — FAIL**.
- [ ] **Step 3: Implement** — `const from = model.resolve(fromId)?.typeOf; const to = model.resolve(toId)?.typeOf; if either undefined → []; const compatible = new Set([to, ...model.supertypesOf(to)]); return model.effectiveSchema(from).fields.filter(f => compatible.has(f.type));`.
- [ ] **Step 4: Run — PASS**.
- [ ] **Step 5: Commit** — `feat(authoring): ModelDraft.referenceMembers schema helper`.

---

### Task 5: Full suite + bump `0.17.0` + publish

- [ ] **Step 1:** `npx tsx --conditions=development --test "src/**/*.test.ts"` + `npm run typecheck` + `npm run build` → all green; `dist/authoring/model-draft.js` has the new methods.
- [ ] **Step 2:** `npm version minor --no-git-tag-version` (0.16.0 → 0.17.0).
- [ ] **Step 3:** `npm publish`; verify `npm view @pragmatic-tech-ai/todl version --registry http://localhost:4873` → `0.17.0`.
- [ ] **Step 4: Commit** (incl. package.json + package-lock) — `chore: release 0.17.0 (ModelDraft mutation)`.

---

### Task 6: Plexus — bump to `^0.17.0`

- [ ] `npm install @pragmatic-tech-ai/todl@^0.17.0 --registry http://localhost:4873`; verify installed version. Commit.

---

### Task 7: Plexus — slim `ArchInstanceModel` to a wrapper

**Files:** Modify `architecture-instance-model.ts`. Gate: `architecture-instance-model.test.ts`, `arch-instance-roundtrip.test.ts`, `arch-canvas-ops.test.ts`, `arch-diagram-document.test.ts`, `drop-resolver.test.ts`.

- [ ] **Step 1: Confirm green baseline** — `npx vitest run src/renderer/src/modules/architecture-projects`.
- [ ] **Step 2: Refactor** — hold `private readonly draft: ModelDraft`; `load(bases, source, namespace)` builds it via `ModelDraft.fromSource(bases.map(d => new Repository(graphFromJSON(d))), source, { namespace })`. Keep `freshId`, `onChanged`/listeners, `mutated()`. Delegate: `createInstance`→`freshId`+`draft.create`+`mutated`; `setField`/`addRelationship`→`draft.addRef`/`removeRelationship`→`draft.removeRef`/`remove` each + `mutated`; `referenceMembers`→`draft.referenceMembers`; `repository()`→`draft.model`; `emit()`→`draft.toTodl()`; `node`/`document`/`ownInstances` via the draft (`document`→`draft.toJSON()`). Import `ModelDraft, Repository, graphFromJSON` from `@pragmatic-tech-ai/todl`.
- [ ] **Step 3: Run the arch suites — all green.** Fix API mismatches against the real `draft` methods.
- [ ] **Step 4: Commit** — `refactor(architecture-projects): ArchInstanceModel wraps TODL ModelDraft`.

---

### Task 8: Plexus full-suite verification

- [ ] `npm run compile:mu` (sanity) + `npx vitest run` (expect prior green baseline) + `npm run typecheck`. Confirm `ArchInstanceModel` no longer hand-rolls delta ops (`grep -n "own.nodes.push\|own.edges.filter" architecture-instance-model.ts` → gone). Commit if any residual.

## Notes for the executor

- TODL tasks 1–5 first; publish `0.17.0` before Plexus task 6.
- Task 1 is the risk: refactor internals with the **existing tests as the gate** before adding any new capability. If `add`'s throw-on-missing-target regresses, stop and fix before proceeding.
- Preserve `ArchInstanceModel`'s exact public API — the canvas/`ArchDiagramDocument` must not change.
