# IconSource member-annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a meta-model author annotate a concept's relationship members with `iconSource { order }` to declare, in priority order, where an instance's icon comes from when it defines no icon of its own.

**Architecture:** Two halves. TODL gains a general capability to annotate relationship members (parser member-body + loader routing) plus an `iconSource` prelude annotation; publish 0.26.0. Plexus's `iconEntityKey` gains a declarative front path (own-icon-first, then `iconSource` members by ascending `order`) and keeps today's heuristic as the fallback when no `iconSource` is declared.

**Tech Stack:** TypeScript (ESM, strict). TODL tests: node:test + node:assert/strict via `tsx`. Plexus tests: vitest. Local Verdaccio registry (localhost:4873).

## Global Constraints

- Publish `@pragmatic-lab/todl` **0.26.0** to local Verdaccio (localhost:4873) ONLY. Never the public npm registry.
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- TODL test command REQUIRES `--test-force-exit`: `npx tsx --conditions=development --test --test-force-exit "src/<path>/tests/<file>.test.ts"`.
- TODL build: `npm run build`. Plexus tests: `npx vitest run <file>`; typecheck: `npm run typecheck`.
- Prelude annotation naming: lowercase `iconSource` (tool-switched keys are lowercase by exception).
- `order : number` is required (no `?`). `number` is a built-in type — no new primitive.
- Member node id = `${concept}.${member}` (bare, not namespace-prefixed); its `iconSource` application node = `${concept}.${member}@iconSource` with attr `order`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- TODL work is on branch `feat/iconsource-member-annotation`. Plexus work starts a new branch off Plexus `main` (Task 6 step 0).

---

## File Structure

**TODL** (`feat/iconsource-member-annotation`)
- `src/parse/ast.ts` — add `annotations` to `RelationshipDecl`.
- `src/parse/parser.ts` — `parseRelationship` accepts a `{ … }` member body of `annotate` statements.
- `src/parse/loader.ts` — applications pass stages member annotations onto member nodes.
- `src/stdlib/prelude.todl` — declare `annotation iconSource { order : number; }`.
- `src/parse/tests/relationship-member-annotation.test.ts` — parser test (new).
- `src/parse/tests/loader-member-annotation.test.ts` — loader test (new).
- `src/stdlib/tests/prelude-iconsource.test.ts` — prelude test (new).

**Plexus** (new branch off `main`)
- `src/renderer/src/modules/architecture-projects/services/arch-icon.ts` — `iconEntityKey` rework + extracted `legacyIconEntityKey`.
- `src/renderer/src/modules/architecture-projects/services/tests/arch-icon-source.test.ts` — new tests.
- `package.json` — bump todl to `^0.26.0`.

---

## Task 1: TODL — parse relationship member bodies

**Files:**
- Modify: `src/parse/ast.ts:157-163` (`RelationshipDecl`)
- Modify: `src/parse/parser.ts:712-730` (`parseRelationship`)
- Test: `src/parse/tests/relationship-member-annotation.test.ts`

**Interfaces:**
- Consumes: existing `parseAnnotationApplication(startToken)` (parser.ts:671 uses it for concept-level `annotate`), `this.startToken()`, `AnnotationApplication` (ast.ts).
- Produces: `RelationshipDecl.annotations: AnnotationApplication[]` (empty for bodyless members). Task 2 reads this.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/relationship-member-annotation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, type ConceptDecl } from "../ast.js";

function concept(text: string): ConceptDecl {
  const decl = parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Concept);
  assert.ok(decl, "expected a concept declaration");
  return decl as ConceptDecl;
}

test("a relationship member body parses its annotate applications", () => {
  const c = concept(`namespace t {
    concept component {
      relationship implementedBy -> technology { annotate iconSource { order = 1; } }
    }
  }`);
  const rel = c.relationships[0];
  assert.equal(rel?.name, "implementedBy");
  assert.equal(rel?.annotations.length, 1);
  assert.equal(rel?.annotations[0]?.name, "iconSource");
  assert.equal(rel?.annotations[0]?.assignments[0]?.name, "order");
});

test("a bodyless relationship parses with an empty annotations array", () => {
  const c = concept(`namespace t {
    concept component { relationship linkedTo -> component; }
  }`);
  assert.deepEqual(c.relationships[0]?.annotations, []);
});

test("a non-annotate statement inside a relationship body is a parse error", () => {
  assert.throws(() =>
    parse(`namespace t {
      concept component { relationship implementedBy -> technology { order = 1; } }
    }`),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/relationship-member-annotation.test.ts"`
Expected: FAIL — `rel.annotations` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add the AST field**

In `src/parse/ast.ts`, add `annotations` to `RelationshipDecl` (import of `AnnotationApplication` already present in the file — it is used by `ConceptDecl`):

```ts
export interface RelationshipDecl {
  name: string;
  targets: string[];
  cardinality: Cardinality;
  annotations: AnnotationApplication[];
  nameSpan?: SourceSpan;
  targetSpans?: SourceSpan[];
}
```

- [ ] **Step 4: Parse the member body**

In `src/parse/parser.ts`, replace the tail of `parseRelationship` (from `const cardinality = this.parseCardinality();` through the `return { … }`):

```ts
    const cardinality = this.parseCardinality();
    const annotations: AnnotationApplication[] = [];
    if (this.match(TokenKind.LBrace)) {
      while (!this.check(TokenKind.RBrace)) {
        if (this.checkKeyword("annotate")) {
          annotations.push(this.parseAnnotationApplication(this.startToken()));
        } else {
          throw this.error('only "annotate" statements are allowed in a relationship body');
        }
      }
      this.expect(TokenKind.RBrace);
    } else {
      this.expect(TokenKind.Semicolon);
    }
    return {
      name: nameTok.value, targets, cardinality, annotations,
      nameSpan: tokenSpan(nameTok, this.uri), targetSpans,
    };
```

Ensure `AnnotationApplication` is imported in parser.ts (it already imports `type RelationshipDecl` and uses `parseAnnotationApplication`; add `AnnotationApplication` to the type import from `./ast.js` if not present).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/relationship-member-annotation.test.ts"`
Expected: PASS (3/3).

- [ ] **Step 6: Run the full parse suite (no regressions)**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/*.test.ts"`
Expected: all green — bodyless relationships across the corpus still parse.

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/relationship-member-annotation.test.ts
git commit -m "feat(todl): parse annotate bodies on relationship members

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: TODL — stage member annotations in the loader

**Files:**
- Modify: `src/parse/loader.ts:464-467` (applications pass, concept branch)
- Test: `src/parse/tests/loader-member-annotation.test.ts`

**Interfaces:**
- Consumes: `RelationshipDecl.annotations` (Task 1), existing `stageApplications(builder, model, target, apps, seen, diagnostics)` (loader.ts:645), member node id convention `${concept}.${name}` (builder.ts:161).
- Produces: application node `${concept}.${member}@<Ann>` at Ontology tier with the annotation's assignments as attrs, resolvable via `repo.resolve(...)`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/loader-member-annotation.test.ts`. Uses a test-local annotation (`heat`) so it is independent of the prelude `iconSource` (Task 3):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";

const SRC = `namespace t {
  annotation heat { level : number; }
  concept technology {}
  concept component {
    relationship implementedBy -> technology { annotate heat { level = 3; } }
    relationship linkedTo -> component;
  }
}`;

test("a member annotation becomes a resolvable application node with its attrs", () => {
  const { model, diagnostics } = load([{ uri: "t.todl", text: SRC }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  const node = model.resolve("component.implementedBy@heat");
  assert.ok(node, "expected component.implementedBy@heat to exist");
  assert.equal(node?.attrs.get("level"), 3);
});

test("a bodyless member has no application node", () => {
  const { model } = load([{ uri: "t.todl", text: SRC }]);
  assert.equal(model.resolve("component.linkedTo@heat"), undefined);
});

test("an undeclared annotation on a member is diagnosed", () => {
  const bad = `namespace t {
    concept technology {}
    concept component { relationship implementedBy -> technology { annotate nope { x = 1; } } }
  }`;
  const { diagnostics } = load([{ uri: "t.todl", text: bad }]);
  assert.ok(diagnostics.some((d) => d.severity === "error"), "expected an error for the undeclared annotation");
});
```

> Note: `diagnostics` severity is compared against the string the diagnostic carries. If `Severity` is an enum whose values are not `"error"`, import `Severity` from `../../diagnostics/diagnostic.js` and compare `d.severity === Severity.Error` instead. Check `src/parse/tests/loader-annotation.test.ts` for the exact convention and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/loader-member-annotation.test.ts"`
Expected: FAIL — `component.implementedBy@heat` is `undefined` (member annotations are parsed but not staged).

- [ ] **Step 3: Route member annotations in the applications pass**

In `src/parse/loader.ts`, in the applications pass concept branch (currently at ~465-467), add member-annotation staging right after the concept-level call:

```ts
    if (decl.kind === DeclKind.Concept) {
      fourth.setNamespace(ns);
      stageApplications(fourth, model, decl.name, decl.annotations, seenApps, diagnostics);
      for (const rel of decl.relationships) {
        if (rel.annotations.length > 0)
          stageApplications(fourth, model, `${decl.name}.${rel.name}`, rel.annotations, seenApps, diagnostics);
      }
    } else if (decl.kind === DeclKind.Package) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/loader-member-annotation.test.ts"`
Expected: PASS (3/3).

- [ ] **Step 5: Run the full parse suite (no regressions)**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/*.test.ts"`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/parse/loader.ts src/parse/tests/loader-member-annotation.test.ts
git commit -m "feat(todl): stage annotations declared on relationship members

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: TODL — declare the `iconSource` prelude annotation

**Files:**
- Modify: `src/stdlib/prelude.todl:9-15` (annotations block)
- Test: `src/stdlib/tests/prelude-iconsource.test.ts`

**Interfaces:**
- Consumes: prelude is injected as the implicit first base by `load`/`checkAgainst`; Task 1 + Task 2 (member-body parse + loader routing).
- Produces: a built-in `iconSource` annotation with a required `order : number`, usable on relationship members without a local declaration.

- [ ] **Step 1: Write the failing test**

Create `src/stdlib/tests/prelude-iconsource.test.ts`. This proves the prelude declares `iconSource` by applying it to a member with no local `annotation` declaration and asserting a clean load + resolvable node:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../../parse/loader.js";

const SRC = `namespace t {
  concept technology {}
  concept component {
    relationship implementedBy -> technology { annotate iconSource { order = 1; } }
  }
}`;

test("iconSource is a built-in annotation usable on a member with no local declaration", () => {
  const { model, diagnostics } = load([{ uri: "t.todl", text: SRC }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  const node = model.resolve("component.implementedBy@iconSource");
  assert.ok(node, "expected component.implementedBy@iconSource to exist");
  assert.equal(node?.attrs.get("order"), 1);
});

test("iconSource requires order (omitting it is an error)", () => {
  const bad = `namespace t {
    concept technology {}
    concept component { relationship implementedBy -> technology { annotate iconSource {} } }
  }`;
  const { diagnostics } = load([{ uri: "t.todl", text: bad }]);
  assert.ok(diagnostics.some((d) => d.severity === "error"), "expected an error for the missing required order");
});
```

> If the prelude-test folder does not exist, create `src/stdlib/tests/`. Match the `severity` comparison convention used by Task 2's test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/stdlib/tests/prelude-iconsource.test.ts"`
Expected: FAIL — `iconSource` is undeclared, so the load reports an "undefined annotation" error and the node is absent.

- [ ] **Step 3: Declare `iconSource` in the prelude**

In `src/stdlib/prelude.todl`, add one line in the standard-annotations block (after the `instance` annotation, line 15):

```todl
    annotation instance { concept : identifier; via : identifier?; }
    annotation iconSource { order : number; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit "src/stdlib/tests/prelude-iconsource.test.ts"`
Expected: PASS (2/2).

- [ ] **Step 5: Run the prelude + parse suites (no regressions)**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/*.test.ts" "src/stdlib/tests/*.test.ts"`
Expected: all green — `prelude-redeclare` and default-library tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/stdlib/prelude.todl src/stdlib/tests/prelude-iconsource.test.ts
git commit -m "feat(todl): add iconSource prelude annotation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: TODL — build, version, publish 0.26.0

**Files:**
- Modify: `package.json` (version → `0.26.0`)

**Interfaces:**
- Consumes: Tasks 1-3 committed.
- Produces: `@pragmatic-lab/todl@0.26.0` on local Verdaccio, consumed by Plexus Task 5.

- [ ] **Step 1: Run the full TODL suite**

Run: `npx tsx --conditions=development --test --test-force-exit "src/**/*.test.ts"`
Expected: all green (the prior baseline was 532 green; this adds the three new test files).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean tsc build, no type errors.

- [ ] **Step 3: Bump version**

Set `"version": "0.26.0"` in `package.json`.

- [ ] **Step 4: Publish to Verdaccio**

Run: `npm publish --registry http://localhost:4873`
Expected: `+ @pragmatic-lab/todl@0.26.0`. (Verify the registry is Verdaccio, never public npm.)

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(todl): release 0.26.0 (iconSource member annotations)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Plexus — bump todl to 0.26.0

**Files:**
- Modify: `package.json` (Plexus, todl dependency)

**Interfaces:**
- Consumes: `@pragmatic-lab/todl@0.26.0` from Verdaccio (Task 4).
- Produces: Plexus resolving 0.26.0, so `repo.resolve('<concept>.<member>@iconSource')` sees member-annotation nodes loaded from source.

- [ ] **Step 0: Start the Plexus branch**

```bash
cd <plexus-root>
git checkout main && git pull
git checkout -b feat/iconsource-icon-resolution
```

- [ ] **Step 1: Bump the dependency**

In Plexus `package.json`, set the todl entry to `"@pragmatic-lab/todl": "^0.26.0"`.

- [ ] **Step 2: Install from Verdaccio**

Run: `npm install --registry http://localhost:4873`
Expected: `@pragmatic-lab/todl@0.26.0` installed (check `node_modules/@pragmatic-lab/todl/package.json`).

- [ ] **Step 3: Typecheck baseline**

Run: `npm run typecheck`
Expected: passes (no consumer break from the todl bump).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(plexus): bump @pragmatic-lab/todl to ^0.26.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Plexus — `iconEntityKey` declarative front path

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-icon.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-icon-source.test.ts`

**Interfaces:**
- Consumes: `Entity.concept`, `Entity.type()`, `Entity.schema().relationships` (each `{ name }`), `Entity.refs(name)` (each `{ id }`), `Repository.resolve(id)?.attrs.get(...)` — all already used by the current `iconEntityKey`.
- Produces: same `iconEntityKey(repo, entity): string | undefined` signature; behavior extended.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/architecture-projects/services/tests/arch-icon-source.test.ts`. Mirrors the fixture style of the existing `arch-icon.test.ts` (real TODL repo from source), but the meta-model annotates members with `iconSource`:

```ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, type Entity } from '@pragmatic-lab/todl'
import { iconEntityKey } from '../arch-icon.js'

// component: implementedBy (order 1) and categorisedAs (order 2) both declare iconSource.
const MM = `namespace t {
  concept category {}
  concept technology {}
  concept component {
    relationship implementedBy -> technology { annotate iconSource { order = 1; } }
    relationship categorisedAs -> category { annotate iconSource { order = 2; } }
  }
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term azure {} }
  viewpoint V : frames component
}`

function repoWith(icons: string[], model: string): { repo: Repository; entity: (id: string) => Entity } {
    const mmDoc = toJSON(load([{ uri: 'mm.todl', text: MM }]).model)
    for (const target of icons)
        mmDoc.nodes.push({ id: `${target}@icon`, tier: 'Ontology', typeOf: 'icon', attrs: { path: `resources/${target}.svg` } })
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [{ uri: 'a.todl', text: model }], { namespace: 't' })
    const insts = new Map(draft.ownInstances().map((e) => [e.id, e]))
    return { repo: draft.model, entity: (id) => insts.get(id)! }
}

const BODY = `namespace t { model M : t conforms V { component c1 { implementedBy = Stack.azure; categorisedAs = Cats.ai; } } }`

test('own icon wins even when iconSource members are declared', () => {
    const { repo, entity } = repoWith(['component', 'Stack.azure', 'Cats.ai'], BODY)
    expect(iconEntityKey(repo, entity('c1'))).toBe('component')
})

test('lowest-order iconSource member with an icon wins (implementedBy before categorisedAs)', () => {
    const { repo, entity } = repoWith(['Stack.azure', 'Cats.ai'], BODY)
    expect(iconEntityKey(repo, entity('c1'))).toBe('Stack.azure')
})

test('a higher-order source is used when the lower-order target has no icon', () => {
    const { repo, entity } = repoWith(['Cats.ai'], BODY)
    expect(iconEntityKey(repo, entity('c1'))).toBe('Cats.ai')
})

test('iconSource declared but no target (nor own) bears an icon yields undefined', () => {
    const { repo, entity } = repoWith([], BODY)
    expect(iconEntityKey(repo, entity('c1'))).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-icon-source.test.ts`
Expected: FAIL — the current heuristic ignores `iconSource`; e.g. the own-first and ordering assertions do not hold (propagation ranking / referenced-term-first picks differently).

- [ ] **Step 3: Rework `arch-icon.ts`**

Replace the file with the declarative front path plus the extracted legacy helper. The `legacyIconEntityKey` body is today's `iconEntityKey` verbatim, using a shared module-level `hasIcon`:

```ts
import type { Entity, Repository } from '@pragmatic-lab/todl'

// "Has an icon": the `<id>@icon` annotation node (source form carries `path`).
function hasIcon(repo: Repository, id: string): boolean {
    const path = repo.resolve(`${id}@icon`)?.attrs.get('path')
    return typeof path === 'string' && path.length > 0
}

// The entity key whose icon a bound canvas node should draw — an id the presentation
// registry's index (registry.iconKeyFor) maps to a baked resource key.
//
// Declarative path (concept has `iconSource`-annotated members): the concept's OWN
// icon wins first; otherwise the icon-bearing target of the lowest-`order` iconSource
// member wins (ties broken by schema order); otherwise undefined (default glyph).
// A concept with NO iconSource member falls back to the legacy heuristic below, so
// existing meta-models resolve exactly as before.
export function iconEntityKey(repo: Repository, entity: Entity): string | undefined
{
    const sources: { member: string; order: number; index: number }[] = []
    let index = 0
    for (const rel of entity.schema().relationships) {
        const order = repo.resolve(`${entity.concept}.${rel.name}@iconSource`)?.attrs.get('order')
        if (typeof order === 'number') sources.push({ member: rel.name, order, index })
        index++
    }

    if (sources.length > 0) {
        const own = entity.type()?.id ?? entity.concept
        if (hasIcon(repo, own)) return own
        sources.sort((a, b) => a.order - b.order || a.index - b.index)
        for (const s of sources)
            for (const target of entity.refs(s.member))
                if (hasIcon(repo, target.id)) return target.id
        return undefined
    }

    return legacyIconEntityKey(repo, entity)
}

// Legacy heuristic (unchanged): a referenced icon-bearing term wins over the own
// type; among several, the propagation SOURCE (higher out-degree toward the other
// candidates) wins, ties by schema order; else the own concept; else undefined.
function legacyIconEntityKey(repo: Repository, entity: Entity): string | undefined
{
    const candidates: string[] = []
    for (const rel of entity.schema().relationships)
        for (const target of entity.refs(rel.name))
            if (hasIcon(repo, target.id)) candidates.push(target.id)

    if (candidates.length === 0) {
        const own = entity.type()?.id ?? entity.concept
        return hasIcon(repo, own) ? own : undefined
    }
    if (candidates.length === 1) return candidates[0]

    const set = new Set(candidates)
    const refsOf = (id: string): Set<string> => {
        const s = new Set<string>()
        for (const [, targets] of repo.effectiveRelationships(id))
            for (const t of targets) s.add(t)
        return s
    }
    const outDegree = (term: string): number => {
        const refs = refsOf(term)
        let n = 0
        for (const other of set) if (other !== term && refs.has(other)) n++
        return n
    }
    let winner = candidates[0]
    let best = outDegree(winner)
    for (const term of candidates.slice(1)) {
        const d = outDegree(term)
        if (d > best) { winner = term; best = d }
    }
    return winner
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-icon-source.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Run the existing arch-icon suite (legacy untouched)**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-icon.test.ts`
Expected: PASS — the legacy path is byte-for-byte the old behavior (its MM declares no `iconSource`).

- [ ] **Step 6: Typecheck + element-presentation regression**

Run: `npm run typecheck && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/element-presentation.test.ts`
Expected: passes — `element-presentation.ts` delegates to `iconEntityKey` unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-icon.ts src/renderer/src/modules/architecture-projects/services/tests/arch-icon-source.test.ts
git commit -m "feat(plexus): resolve icons via iconSource member annotations

Own icon first, then iconSource members by ascending order; concepts with
no iconSource fall back to the legacy propagation heuristic.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Part A (member annotations): Task 1 (parser) + Task 2 (loader). ✓
- Part B (`iconSource` prelude): Task 3. ✓
- Part C (`iconEntityKey` rework — own-first, ordered, legacy fallback): Task 6. ✓
- Cross-repo/versioning (0.26.0 publish + Plexus bump): Task 4 + Task 5. ✓
- Testing rows (parse, load, validation, prelude, own-first, ordered pick, declared-but-none, legacy untouched): Tasks 1-3, 6. ✓
- Non-goal "no emitter round-trip": no task touches the emitter. ✓

**Type consistency:** `iconEntityKey(repo, entity): string | undefined` unchanged across Task 6. `RelationshipDecl.annotations: AnnotationApplication[]` defined in Task 1, read in Task 2. Member id `${concept}.${member}@<Ann>` consistent across Tasks 2, 3, 6. `hasIcon(repo, id)` module-level in Task 6, called by both paths.

**Placeholder scan:** No TBD/TODO; every code step carries real code. The two `> Note` callouts point the implementer to an existing test to copy the `severity` comparison convention — not a placeholder, a grounded instruction.

**Ambiguity resolved:** `Severity` enum-vs-string comparison flagged with a concrete fallback and a reference file. Prelude test folder creation noted.
