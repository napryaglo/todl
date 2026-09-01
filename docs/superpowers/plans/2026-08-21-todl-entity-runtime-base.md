# TODL Entity Runtime Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TODL-generated concept classes a real, bindable base (mural's `Observable`, relocated to a new `@pragmatic-tech-ai/todl-runtime` package) and retarget the js-module emitter to emit `Observable` subclasses with per-member getters/setters — so a realized diagram node can be data-bound and `DataTemplate`-dispatched by mural.

**Architecture:** A new zero-dependency `@pragmatic-tech-ai/todl-runtime` package owns `Observable` (moved verbatim out of mural) + its `PropertyChangeCallback` type. mural depends on it and re-exports `Observable`, so `MuralBase extends Observable` and every consumer import resolve the *same* class object. The emitter emits `class <Concept> extends Observable` from that package, with a private field + getter + change-guarded setter (calling `RaisePropertyChanged`) per member and a `constructor(init)` that hydrates via those setters.

**Tech Stack:** TypeScript (strict, ESM); `tsx --conditions=development --test` test runner; local Verdaccio registry.

**Spec:** [docs/superpowers/specs/2026-08-21-todl-entity-runtime-base-design.md](../specs/2026-08-21-todl-entity-runtime-base-design.md)

## Global Constraints

- Publish `@pragmatic-tech-ai/todl-runtime`, `@pragmatic-tech-ai/mural`, `@pragmatic-tech-ai/todl` **only** to Verdaccio (`http://localhost:4873`), never public npm, and **only** when the user asks. Commit/push only when the user asks; branch first if on a default branch.
- A fixed set of named string values is a real TypeScript `enum`, never a string-literal union.
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- `todl-runtime` depends on **nothing**; mural depends on `todl-runtime` but NOT on the `@pragmatic-tech-ai/todl` compiler; TODL does not depend on mural.
- `Observable` behavior is unchanged by the move; the full mural suite stays green with zero behavioral change (**parity gate**). Run `npm test` in mural at Task 2's verification.
- No public API removed — `Observable` + `PropertyChangeCallback` stay importable from `@pragmatic-tech-ai/mural/runtime`, and must be the *same class object* as `@pragmatic-tech-ai/todl-runtime`'s.

---

## File Structure

- `todl-runtime/` — **new package dir** (sibling of Mural/Fresco/TODL). `src/observable.ts` (moved `Observable` + `PropertyChangeCallback`), `src/index.ts` (barrel), `src/tests/observable.test.ts`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `.npmrc`, `README.md`.
- `Mural/src/runtime/observable.ts` — becomes a one-line **re-export barrel** of `@pragmatic-tech-ai/todl-runtime`.
- `Mural/src/runtime/binding/effective-value.ts` — drops the local `PropertyChangeCallback` definition; imports+re-exports it from `@pragmatic-tech-ai/todl-runtime`; keeps `InternalPropertyChangeCallback`.
- `Mural/package.json` — adds the `@pragmatic-tech-ai/todl-runtime` dependency; version bump.
- `TODL/src/emit/js-module.ts` — import/base retarget; per-member accessor + `constructor` emission; registry factory change.
- `TODL/src/emit/tests/js-module.test.ts` — updated + new assertions.
- `Plexus/package.json` — mural dependency bump (follow-on).

---

## Task 1: New `@pragmatic-tech-ai/todl-runtime` package owning `Observable`

Stand up the new package with `Observable` authored in it (identical to mural's current class) and its own passing tests. mural is untouched in this task, so both repos stay green.

**Files:**
- Create: `todl-runtime/package.json`, `todl-runtime/tsconfig.json`, `todl-runtime/tsconfig.build.json`, `todl-runtime/.npmrc`, `todl-runtime/README.md`, `todl-runtime/src/observable.ts`, `todl-runtime/src/index.ts`
- Test: `todl-runtime/src/tests/observable.test.ts`

**Interfaces:**
- Produces: package `@pragmatic-tech-ai/todl-runtime` exporting `class Observable` (public `AddPropertyChangedListener(name: string, cb)` / `RemovePropertyChangedListener(name: string, cb)`, protected `RaisePropertyChanged(name, oldValue, newValue)`) and `type PropertyChangeCallback = (owner: Observable, property: string, old_value: any, new_value: any) => void`.

- [ ] **Step 1: Scaffold the package dir.** From `architecture-agent/`, create `todl-runtime/` with `src/` and `src/tests/`. Copy `.npmrc` verbatim from `Mural/.npmrc` (the Verdaccio scope + registry + auth token). Copy the `tsx`, `typescript`, and `rimraf` devDependency version strings from `Mural/package.json` into the new `package.json` below.

- [ ] **Step 2: Write `todl-runtime/package.json`:**
  ```json
  {
    "name": "@pragmatic-tech-ai/todl-runtime",
    "version": "0.1.0",
    "description": "Runtime base for TODL-generated entities: a minimal name/setter INotifyPropertyChanged (Observable).",
    "type": "module",
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
    "files": ["dist", "README.md"],
    "publishConfig": { "registry": "http://localhost:4873/", "access": "public" },
    "scripts": {
      "build": "tsc -p tsconfig.build.json",
      "clean": "rimraf dist",
      "prepublishOnly": "npm run clean && npm run build",
      "test": "tsx --conditions=development --test \"src/**/*.test.ts\"",
      "typecheck": "tsc --noEmit"
    },
    "devDependencies": { "rimraf": "<copy from Mural>", "tsx": "<copy from Mural>", "typescript": "<copy from Mural>" }
  }
  ```

- [ ] **Step 3: Write `todl-runtime/tsconfig.json`** (strict ESM, checks `src`):
  ```json
  {
    "compilerOptions": {
      "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
      "strict": true, "declaration": true, "esModuleInterop": true,
      "skipLibCheck": true, "outDir": "dist", "rootDir": "src"
    },
    "include": ["src"]
  }
  ```
  and `todl-runtime/tsconfig.build.json`:
  ```json
  { "extends": "./tsconfig.json", "exclude": ["src/**/tests/**"] }
  ```

- [ ] **Step 4: Write the failing test** — `todl-runtime/src/tests/observable.test.ts`:
  ```ts
  import { test } from 'node:test'
  import assert from 'node:assert/strict'
  import { Observable } from '../index.js'

  class Loc extends Observable {
    #label = ''
    get label(): string { return this.#label }
    set label(v: string) {
      const o = this.#label
      if (o === v) return
      this.#label = v
      // RaisePropertyChanged is protected; a subclass may call it.
      ;(this as unknown as { RaisePropertyChanged(n: string, o: unknown, v: unknown): void })
        .RaisePropertyChanged('label', o, v)
    }
  }

  test('notifies by name on setter change', () => {
    const l = new Loc()
    const seen: Array<[string, unknown]> = []
    l.AddPropertyChangedListener('label', (_o, name, _old, nv) => seen.push([name, nv]))
    l.label = 'Azure'
    assert.equal(l.label, 'Azure')
    assert.deepEqual(seen, [['label', 'Azure']])
  })

  test('equal-value set fires nothing', () => {
    const l = new Loc()
    let fired = 0
    l.AddPropertyChangedListener('label', () => { fired++ })
    l.label = ''
    assert.equal(fired, 0)
  })

  test('unsubscribed instance allocates no listener map', () => {
    const l = new Loc()
    assert.equal((l as unknown as { _listeners?: unknown })._listeners, undefined)
  })

  test('RemovePropertyChangedListener stops delivery', () => {
    const l = new Loc()
    let fired = 0
    const cb = (): void => { fired++ }
    l.AddPropertyChangedListener('label', cb)
    l.RemovePropertyChangedListener('label', cb)
    l.label = 'x'
    assert.equal(fired, 0)
  })
  ```

- [ ] **Step 5: Run it — expect failure** (no `Observable` yet): `cd todl-runtime && npx tsx --test src/tests/observable.test.ts` → FAIL.

- [ ] **Step 6: Write `todl-runtime/src/observable.ts`** (verbatim behavior of mural's current `Observable`):
  ```ts
  // Minimal INotifyPropertyChanged analog. Change notification keyed by
  // property NAME, driven by subclass getters/setters that call
  // `RaisePropertyChanged`. No dependency-property machinery — the shared
  // base for both mural's MuralBase and TODL-generated entity classes.
  export type PropertyChangeCallback = (
    owner: Observable,
    property: string,
    old_value: any,
    new_value: any,
  ) => void

  export class Observable {
    private _listeners?: Map<string, PropertyChangeCallback[]>

    public AddPropertyChangedListener(name: string, callback: PropertyChangeCallback): void {
      const listeners = (this._listeners ??= new Map())
      let arr = listeners.get(name)
      if (arr === undefined) { arr = []; listeners.set(name, arr) }
      arr.push(callback)
    }

    public RemovePropertyChangedListener(name: string, callback: PropertyChangeCallback): void {
      const arr = this._listeners?.get(name)
      if (arr === undefined) return
      const i = arr.indexOf(callback)
      if (i >= 0) arr.splice(i, 1)
    }

    // Subclass setters call this AFTER writing the backing field, only on a
    // real change. Fires (owner, name, old, new).
    protected RaisePropertyChanged(name: string, oldValue: unknown, newValue: unknown): void {
      const cbs = this._listeners?.get(name)
      if (cbs) for (const cb of [...cbs]) cb(this, name, oldValue, newValue)
    }
  }
  ```

- [ ] **Step 7: Write `todl-runtime/src/index.ts`:**
  ```ts
  export { Observable, type PropertyChangeCallback } from './observable.js'
  ```

- [ ] **Step 8: Install deps, run test — expect pass.** `cd todl-runtime && npm install && npx tsx --test src/tests/observable.test.ts` → PASS. Then `npm run typecheck` → clean, `npm run build` → emits `dist/`.

- [ ] **Step 9: Publish `0.1.0` to Verdaccio (USER-GATED).** Ask the user; on approval: `cd todl-runtime && npm publish` (prepublishOnly builds). Confirm the log says `Publishing to http://localhost:4873/`.

- [ ] **Step 10: Commit.**
  ```bash
  cd todl-runtime && git init -q 2>/dev/null; git add -A
  git commit -m "feat: @pragmatic-tech-ai/todl-runtime — Observable base for generated entities"
  ```

---

## Task 2: mural relocates `Observable` to the re-export barrel

Point mural at `todl-runtime`'s `Observable` and delete its local copy, keeping every internal `./observable.js` import working via a re-export barrel. Behavior is byte-for-byte identical (parity gate).

**Files:**
- Modify: `Mural/src/runtime/observable.ts` (→ re-export barrel), `Mural/src/runtime/binding/effective-value.ts` (drop local `PropertyChangeCallback`, re-export from `todl-runtime`), `Mural/package.json` (add dependency + version bump)
- Test: existing mural suite is the gate (no new test file)

**Interfaces:**
- Consumes: `@pragmatic-tech-ai/todl-runtime` `0.1.0` (Task 1) — `Observable`, `PropertyChangeCallback`.
- Produces: `Observable` + `PropertyChangeCallback` still exported from `@pragmatic-tech-ai/mural/runtime`, now the same class object as `todl-runtime`.

- [ ] **Step 1: Add the dependency.** In `Mural/package.json` `dependencies`, add `"@pragmatic-tech-ai/todl-runtime": "^0.1.0"`. Run `cd Mural && npm install @pragmatic-tech-ai/todl-runtime@0.1.0`.

- [ ] **Step 2: Replace `Mural/src/runtime/observable.ts` entirely** with the barrel:
  ```ts
  // Observable now lives in @pragmatic-tech-ai/todl-runtime so TODL-generated
  // entity classes and mural's MuralBase share one class identity (mural's
  // binding + DataTemplate dispatch gate on `instanceof Observable`).
  // Re-exported here so every existing `./observable.js` import is unchanged.
  export { Observable } from '@pragmatic-tech-ai/todl-runtime'
  ```

- [ ] **Step 3: Retarget `PropertyChangeCallback` in `Mural/src/runtime/binding/effective-value.ts`.** Delete the local `export type PropertyChangeCallback = (...)` block. Add near the top, after the existing imports:
  ```ts
  import type { PropertyChangeCallback } from '@pragmatic-tech-ai/todl-runtime'
  export type { PropertyChangeCallback }
  ```
  Keep `InternalPropertyChangeCallback` (it uses `MuralBase`, unchanged). If the file's `import type { Observable } from '../observable.js'` (added for the old local definition) is now unused, remove it — `npx tsc --noEmit` will flag it under `noUnusedLocals` if so.

- [ ] **Step 4: Typecheck.** `cd Mural && npx tsc --noEmit` → clean. A missed reference surfaces as an unresolved `Observable`/`PropertyChangeCallback`.

- [ ] **Step 5: Run the full suite — parity gate.** `cd Mural && npm test`. Expected: all green, identical counts to before (4477 pass / 0 fail / 3 skip baseline), `MuralBase`/`Visual` behavior identical.

- [ ] **Step 6: Bump + publish (USER-GATED).** `cd Mural && npm version minor --no-git-tag-version` (→ 0.20.0). Ask the user; on approval `npm publish` (Verdaccio only).

- [ ] **Step 7: Commit.**
  ```bash
  cd Mural && git add -A
  git commit -m "refactor(runtime): relocate Observable to @pragmatic-tech-ai/todl-runtime (re-export barrel)"
  ```

---

## Task 3: Retarget the js-module emitter to emit bindable `Observable` subclasses

Emit `class <Concept> extends Observable` (from `@pragmatic-tech-ai/todl-runtime`), with a private field + getter + guarded setter per member and a hydrating `constructor(init)`; change the registry factory to `new <Cls>(data)`.

**Files:**
- Modify: `TODL/src/emit/js-module.ts` (`DEFAULT_RUNTIME_IMPORT`, the import line, `emitConcept`, `emitRegistry`)
- Test: `TODL/src/emit/tests/js-module.test.ts`

**Interfaces:**
- Consumes: `MetaModuleOptions.runtimeImport` (existing override), `model.schemaOf(concept)` → `{ fields: FieldSchema[], relationships: RelationshipSchema[] }`, `pascalCase`, `jsKey`, `jsStr` (existing helpers).
- Produces: emitted modules whose classes extend `Observable`, expose one accessor per field+relationship, and hydrate via `constructor(init)`; registry `constructors` call `new <Cls>(data)`.

- [ ] **Step 1: Update the failing tests** — in `TODL/src/emit/tests/js-module.test.ts` change the base-class test (lines ~30-36) to:
  ```ts
  test("emits Observable subclasses for each concept", () => {
    const js = toMetaModule(corpus(), { slug: "bpmn" });
    assert.match(js, /import \{ Observable \} from "@pragmatic-tech-ai\/todl-runtime";/);
    assert.match(js, /export class Task extends Observable \{/);
    assert.match(js, /export class Event extends Observable \{/);
    assert.match(js, /kind: "Task",/);
  });
  ```
  and add a new test asserting a bindable accessor + constructor for a field:
  ```ts
  test("emits a private field, getter, guarded setter, and hydrating constructor per member", () => {
    const model = load([
      `namespace n { concept Task { label : string; assignee : string?; } }`,
    ]);
    const js = toMetaModule(model, { slug: "n" });
    assert.match(js, /#label;/);
    assert.match(js, /get label\(\) \{ return this\.#label; \}/);
    assert.match(
      js,
      /set label\(v\) \{ const o = this\.#label; if \(o === v\) return; this\.#label = v; this\.RaisePropertyChanged\("label", o, v\); \}/,
    );
    assert.match(js, /constructor\(init = \{\}\) \{/);
    assert.match(js, /if \("label" in init\) this\.label = init\.label;/);
    assert.match(js, /if \("assignee" in init\) this\.assignee = init\.assignee;/);
  });
  ```
  and update the registry-constructor assertion (line ~96) to:
  ```ts
  assert.match(js, /Task: data => new Task\(data \?\? \{\}\),/);
  ```

- [ ] **Step 2: Run the emitter tests — expect failure.** `cd TODL && npx tsx --test src/emit/tests/js-module.test.ts` → FAIL (still emits `ModelElement`, no accessors, old factory).

- [ ] **Step 3: Retarget the import + base.** In `js-module.ts`: set `const DEFAULT_RUNTIME_IMPORT = "@pragmatic-tech-ai/todl-runtime";` (line 21), change the emitted import (line 52) to ``import { Observable } from ${jsStr(runtimeImport)};``, and in `emitConcept` change `extends ModelElement` (line 87) to `extends Observable`. Update the file's header JSDoc references to `ModelElement` → `Observable`.

- [ ] **Step 4: Emit per-member accessors + constructor in `emitConcept`.** After the `static schema = { … };` block and before the closing `}` of the class, emit accessors for every field AND every relationship, then a constructor. Add this helper and call it:
  ```ts
  // Members that become bindable accessors: fields + relationships, in a
  // stable order. A member literally named `constructor` would shadow the
  // class constructor — reject it loudly rather than emit broken code.
  function memberNames(schema: { fields: FieldSchema[]; relationships: RelationshipSchema[] }): string[] {
    const names = [...schema.fields.map((f) => f.name), ...schema.relationships.map((r) => r.name)];
    for (const n of names) {
      if (n === "constructor") throw new Error(`Concept member may not be named 'constructor'.`);
    }
    return names;
  }

  function emitAccessors(names: string[], i: string): string[] {
    const lines: string[] = [];
    for (const name of names) {
      lines.push(`${i}#${name};`);
      lines.push(`${i}get ${name}() { return this.#${name}; }`);
      lines.push(
        `${i}set ${name}(v) { const o = this.#${name}; if (o === v) return; ` +
          `this.#${name} = v; this.RaisePropertyChanged(${jsStr(name)}, o, v); }`,
      );
    }
    return lines;
  }

  function emitConstructor(names: string[], i: string): string[] {
    const lines: string[] = [`${i}constructor(init = {}) {`, `${i}${i}super();`];
    for (const name of names) {
      lines.push(`${i}${i}if (${jsStr(name)} in init) this.${name} = init.${name};`);
    }
    lines.push(`${i}}`);
    return lines;
  }
  ```
  In `emitConcept`, after `lines.push(\`${i}};\`);` (the schema close) and before `lines.push("}")`, insert:
  ```ts
  const names = memberNames(schema);
  if (names.length > 0) {
    lines.push("");
    lines.push(...emitAccessors(names, i));
    lines.push("");
    lines.push(...emitConstructor(names, i));
  }
  ```
  (`FieldSchema`/`RelationshipSchema` are already imported at the top of `js-module.ts`.)

- [ ] **Step 5: Change the registry factory** in `emitRegistry` (lines ~189-197): replace the `constructors` loop body with:
  ```ts
  lines.push(`${i}constructors: {`);
  for (const concept of concepts) {
    const cls = pascalCase(concept);
    lines.push(`${i}${i}${jsKey(concept)}: data => new ${cls}(data ?? {}),`);
  }
  lines.push(`${i}},`);
  ```

- [ ] **Step 6: Run the emitter tests — expect pass.** `cd TODL && npx tsx --test src/emit/tests/js-module.test.ts` → PASS.

- [ ] **Step 7: Run the full TODL suite + typecheck.** `cd TODL && npm test` (601 baseline + the changed emitter tests, 0 fail) and `npx tsc --noEmit` clean.

- [ ] **Step 8: Bump + publish (USER-GATED).** `cd TODL && npm version patch --no-git-tag-version`. Ask the user; on approval `npm publish` (Verdaccio only).

- [ ] **Step 9: Commit.**
  ```bash
  cd TODL && git add -A
  git commit -m "feat(emit): generated concepts extend Observable with bindable accessors"
  ```

---

## Task 4: Plexus dependency bump + full verification

Pull the relocated mural into Plexus and confirm nothing regresses across unit + typecheck + live e2e. Plexus code is unchanged — `Observable` is still imported from `@pragmatic-tech-ai/mural/runtime`.

**Files:**
- Modify: `Plexus/package.json` (mural version bump)
- Test: existing Plexus vitest suite + the e2e harness are the gate

**Interfaces:**
- Consumes: the relocated mural (Task 2, e.g. `0.20.0`) which transitively pulls `@pragmatic-tech-ai/todl-runtime`.

- [ ] **Step 1: Bump + install.** In `Plexus/package.json`, set `@pragmatic-tech-ai/mural` to `^0.20.0` (the Task 2 version). `cd Plexus && npm install @pragmatic-tech-ai/mural@0.20.0`. Confirm `@pragmatic-tech-ai/todl-runtime` resolved into `node_modules` (transitive).

- [ ] **Step 2: Typecheck.** `cd Plexus && npm run typecheck` → 0 errors.

- [ ] **Step 3: Unit suite.** `cd Plexus && npm test` → all pass (864 baseline / 0 fail).

- [ ] **Step 4: Live e2e.** `cd Plexus && npm run build && npm run test:e2e` → 8/8 pass (boot with zero renderer errors, EditorShell reachable, panels/document/settings render). This confirms the `Observable` relocation is invisible to the running app.

- [ ] **Step 5: Commit.**
  ```bash
  cd Plexus && git commit -am "chore: bump @pragmatic-tech-ai/mural to ^0.20.0 (Observable relocation)"
  ```

---

## Self-Review

- **Spec coverage:** todl-runtime package (Task 1), mural relocation + re-export (Task 2), emitter retarget with per-member accessors + constructor + registry factory (Task 3), Plexus bump + verification (Task 4). The spec's "cross-identity" test is realized in Task 4 Step 4 (the live app is the same-class proof) plus the mural parity gate (Task 2). Rollout order matches the spec's Migration section.
- **Placeholder scan:** the two `<copy from Mural>` markers in Task 1 are concrete copy actions (named source file), not vague TODOs; all code steps carry full code blocks.
- **Type consistency:** `Observable` API (`AddPropertyChangedListener(name, cb)`, `RemovePropertyChangedListener(name, cb)`, protected `RaisePropertyChanged(name, old, new)`) and `PropertyChangeCallback = (owner: Observable, property, old_value: any, new_value: any)` are identical across Tasks 1-3. The emitted setter body in Task 3 Step 1 (test) matches Step 4 (implementation) exactly. `new <Cls>(data ?? {})` in Step 5 matches the test in Step 1.
- **Scope:** no reference resolution, no realization factory, no `DataTemplate` authoring surface — all deferred per the spec's Out of Scope.

## Execution options

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between; the three publishes are user-gated pauses.
2. **Inline Execution** — execute in this session with checkpoints.
