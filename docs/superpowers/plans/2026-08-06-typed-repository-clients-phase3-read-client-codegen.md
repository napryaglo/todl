# Typed Repository Clients — Phase 3: Read-Client Codegen (Component C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, from a compiled `TodlDocument`, a `.ts` source with a typed **package class** (per-concept + per-taxonomy collection accessors) and a typed **entity class per concept** (scalar + reference getters), so a consumer works with `catalog.technologies[0].availableIn[0].label` instead of raw graph queries — reference getters return real typed handles because construction is routed through a registry.

**Architecture:** A new `createEntity(id)` construction seam on `Repository` (default → `EntityBase`) lets a generated package class register a concept→entity-class map so `entity()`/`ref()`/`refs()` yield typed instances from the identity map. The generator reflects a `FrozenRepository` (concepts, taxonomies, `effectiveSchema`) and emits: the package class `extends FrozenRepository` with an overridden `createEntity` + collection accessors, and one `class <Concept> extends EntityBase` per concept with `get <member>()` getters (scalars via `this.field(x) as T`; references via `this.ref(x)/refs(x) as T`, sound because the seam built the right runtime type). Golden-file tests: a committed `.ts` fixture that is both matched byte-for-byte by the generator AND imported+exercised (so tsc type-checks it and a runtime test proves it works).

**Tech Stack:** TypeScript (ESM, strict), Node's built-in test runner via `tsx` (`node:test` + `node:assert/strict`). Emits plain TS text (no template engine).

## Global Constraints

- **This plan is Phase 3 of 7** (spec §14) and **stacks on Phase 2's branch** `feat/typed-clients-phase2` (needs `FrozenRepository`). Build **only** Component C (spec §6). Do NOT build `ModelDraft` (Phase 4), authoring codegen (Phase 5), or the `GraphStore` seam (Phase 6/7).
- **Generator input is a single resolved graph.** It reflects one `Repository`/`FrozenRepository` that already contains the concept schemas AND the instances/terms to surface. Composing a meta-model + a library into one graph before generating is the **caller's** job (load both, or `fromJSON` a doc that has both) — the generator does not resolve across separate bases. Documented boundary; not a gap.
- **Naming (spec §6):** artifact id kebab → PascalCase package class (`microsoft-tech`→`MicrosoftTech`); concept id kebab → PascalCase entity class (`available-in`→ n/a; `app-component`→`AppComponent`); member id kebab → camelCase accessor (`implemented-by`→`implementedBy`, `available-in`→`availableIn`). Collection accessor = pluralized camel concept id (`technology`→`technologies`, `location`→`locations`); taxonomy accessor = camel taxonomy id (`stack`→`stack`).
- **Collision rule (spec §13):** if two distinct source ids map to the same generated identifier, the generator **throws** a clear error (reject on clash), never silently shadows.
- **Scalar vs reference by declared type** (spec §6): an `effectiveSchema` field whose `type` resolves to a `MetaKind.Primitive` node → scalar getter; whose `type` resolves to `MetaKind.Concept`/`MetaKind.Taxonomy` → reference getter. `.relationships` are always reference getters.
- **A concept collection excludes classes** (`instancesOf(c).filter(id => !isClass(id))`); a taxonomy collection is `termsOf(tax)`. (Terms are typed by their concept, so a raw `instancesOf` would wrongly include them.)
- **Additive only.** The `createEntity` seam is behaviour-preserving (default returns `EntityBase`, exactly as today). Every existing test stays green.
- **Every test file lives in a `tests/` subfolder.** Use real enums, never string-literal unions.
- Test: `npx tsx --conditions=development --test "src/**/*.test.ts"`. Typecheck: `npm run typecheck`. Build: `npm run build`.

### Resolved design decisions

1. **`createEntity` seam.** `Repository.entity()` calls `this.createEntity(id)` (was `new EntityBase(this, id)`); `protected createEntity(id): EntityBase { return new EntityBase(this, id); }`. Generated package class overrides it with a `switch (this.resolve(id)?.typeOf)` returning typed subclasses, `default: super.createEntity(id)`.
2. **Entity subclasses use the public lens API**, not `this.repo` (private): scalar getter `this.field(name) as T`; single ref `this.ref(name) as T | undefined`; many ref `this.refs(name) as T[]`. No `entityRef(name, Ctor)` helper is needed — the seam already returns the right runtime type; the getter only casts.
3. **All entity classes extend `EntityBase` directly.** Mirroring concept `extends` in the class hierarchy is spec-"optional" and deferred (YAGNI).
4. **Generator signature:** `generateReadClient(repo: Repository, options: { name: string; importSpecifier?: string }): string`. `name` = artifact id (kebab). `importSpecifier` defaults to `"@pragmatic-lab/todl"`; the in-repo golden fixture uses a relative import so tsx resolves it (set via the option).
5. **Deterministic output:** concepts, taxonomies, members, and switch cases are emitted **sorted by id** so output is stable for golden matching.
6. **Golden fixture is a real committed `.ts`** under `src/codegen/tests/fixtures/` that (a) the generator must reproduce byte-for-byte and (b) a separate test imports and exercises — double duty as compile-check + runtime-check.

### File structure

- `src/model/model.ts` *(modify)* — add `protected createEntity(id): EntityBase`; `entity()` calls it.
- `src/codegen/naming.ts` *(create)* — `pascalCase`, `camelCase`, `pluralize`, `allocateNames` (collision-checked); pure string utils.
- `src/codegen/read-client.ts` *(create)* — `generateReadClient(repo, options): string` + `isReferenceType(repo, typeId): boolean`.
- `src/index.ts` *(modify)* — export `generateReadClient`.
- `src/codegen/tests/naming.test.ts` *(create)* — Task 2 tests.
- `src/codegen/tests/fixtures/tech-catalog.generated.ts` *(create)* — the golden client (Task 3).
- `src/codegen/tests/read-client.test.ts` *(create)* — generate-matches-golden + golden-runs (Task 3).

---

## Task 1: `createEntity` construction seam

**Files:**
- Modify: `src/model/model.ts`
- Test: `src/model/tests/create-entity.test.ts` (create)

**Interfaces:**
- Produces: `protected createEntity(id: NodeId): EntityBase` on `Repository`; `entity()` routes construction through it, so a subclass overriding `createEntity` makes `entity()`/`ref()`/`refs()` return its typed handles.

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/create-entity.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { EntityBase } from "../entity.js";
import type { NodeId } from "../graph.js";

class Widget extends EntityBase {
  get label(): string {
    return this.field("label") as string;
  }
}

// A Repository whose `component` nodes hydrate as Widgets via the seam.
class WidgetRepo extends Repository {
  protected override createEntity(id: NodeId): EntityBase {
    return this.resolve(id)?.typeOf === "component" ? new Widget(this, id) : super.createEntity(id);
  }
}

function repo(): WidgetRepo {
  const r = new WidgetRepo();
  const b = r.builder();
  b.defineConcept("component");
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.assertInstance("component", "web");
  b.addRelationship("gw", "peer", "web");
  b.commit();
  return r;
}

test("createEntity routes entity() construction to a typed subclass", () => {
  const r = repo();
  const gw = r.entity("gw")!;
  assert.ok(gw instanceof Widget);
  assert.equal((gw as Widget).label, "Gateway");
});

test("references resolve to the typed handle from the identity map", () => {
  const r = repo();
  const peer = r.entity("gw")!.ref("peer");
  assert.ok(peer instanceof Widget);
  assert.equal(peer, r.entity("web"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test src/model/tests/create-entity.test.ts`
Expected: FAIL — `gw instanceof Widget` is false (base `entity()` still builds a plain `EntityBase`).

- [ ] **Step 3: Add the seam**

In `src/model/model.ts`, change the body of `entity()` to call `this.createEntity(id)` instead of `new EntityBase(this, id)`:

```ts
  entity<T extends Entity = Entity>(id: NodeId): T | undefined {
    if (!this.has(id)) return undefined;
    let handle = this.entityCache.get(id);
    if (handle === undefined) {
      handle = this.createEntity(id);
      this.entityCache.set(id, handle);
    }
    return handle as unknown as T;
  }

  /** Construct the handle for `id`. Override to return a typed EntityBase subclass. */
  protected createEntity(id: NodeId): EntityBase {
    return new EntityBase(this, id);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test src/model/tests/create-entity.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: whole suite green (Phase 1/2 tests unaffected — default `createEntity` returns `EntityBase`); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/model/model.ts src/model/tests/create-entity.test.ts
git commit -m "feat(model): add createEntity construction seam for typed entity subclasses

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Naming + classification utilities

**Files:**
- Create: `src/codegen/naming.ts`
- Test: `src/codegen/tests/naming.test.ts` (create)

**Interfaces:**
- Produces:
  - `pascalCase(kebab: string): string` — `"app-component"` → `"AppComponent"`.
  - `camelCase(kebab: string): string` — `"implemented-by"` → `"implementedBy"`.
  - `pluralize(word: string): string` — English heuristic: `y`→`ies` (after consonant), `s/x/z/ch/sh`→`es`, else `+s`.
  - `allocateNames(ids: readonly string[], transform: (id: string) => string): Map<string, string>` — applies `transform`, throwing on collision (`two ids "<a>"/"<b>" both map to "<name>"`).

- [ ] **Step 1: Write the failing test**

Create `src/codegen/tests/naming.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pascalCase, camelCase, pluralize, allocateNames } from "../naming.js";

test("pascalCase joins kebab segments and capitalizes each", () => {
  assert.equal(pascalCase("component"), "Component");
  assert.equal(pascalCase("app-component"), "AppComponent");
  assert.equal(pascalCase("microsoft-tech"), "MicrosoftTech");
});

test("camelCase lowercases the first segment, capitalizes the rest", () => {
  assert.equal(camelCase("label"), "label");
  assert.equal(camelCase("implemented-by"), "implementedBy");
  assert.equal(camelCase("available-in"), "availableIn");
});

test("pluralize applies the English heuristic", () => {
  assert.equal(pluralize("component"), "components");
  assert.equal(pluralize("technology"), "technologies");
  assert.equal(pluralize("category"), "categories");
  assert.equal(pluralize("location"), "locations");
  assert.equal(pluralize("box"), "boxes");
  assert.equal(pluralize("stack"), "stacks");
});

test("allocateNames maps each id and throws on a collision", () => {
  const map = allocateNames(["app-component", "technology"], pascalCase);
  assert.equal(map.get("technology"), "Technology");
  assert.throws(() => allocateNames(["chat-surface", "chat--surface"], pascalCase), /collision|both map/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/codegen/tests/naming.test.ts`
Expected: FAIL — cannot resolve `../naming.js`.

- [ ] **Step 3: Implement `src/codegen/naming.ts`**

```ts
/** Identifier-shaping + collision detection for read-client codegen (spec §6, §13). */

function segments(kebab: string): string[] {
  return kebab.split("-").filter((s) => s.length > 0);
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** kebab → PascalCase: "app-component" → "AppComponent". */
export function pascalCase(kebab: string): string {
  return segments(kebab).map(cap).join("");
}

/** kebab → camelCase: "implemented-by" → "implementedBy". */
export function camelCase(kebab: string): string {
  const parts = segments(kebab);
  if (parts.length === 0) return "";
  return parts[0]! + parts.slice(1).map(cap).join("");
}

/** English pluralization heuristic (deterministic; collisions caught by allocateNames). */
export function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/.test(word)) return word + "es";
  return word + "s";
}

/** Map each id through `transform`, throwing on a collision. */
export function allocateNames(
  ids: readonly string[],
  transform: (id: string) => string,
): Map<string, string> {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const id of ids) {
    const name = transform(id);
    const clash = byName.get(name);
    if (clash !== undefined) {
      throw new Error(`codegen name collision: ids "${clash}" and "${id}" both map to "${name}"`);
    }
    byName.set(name, id);
    byId.set(id, name);
  }
  return byId;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/codegen/tests/naming.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/codegen/naming.ts src/codegen/tests/naming.test.ts
git commit -m "feat(codegen): naming + collision-detection utilities

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: The generator + golden fixture (matched + run)

**Files:**
- Create: `src/codegen/read-client.ts`
- Create: `src/codegen/tests/fixtures/tech-catalog.generated.ts` (the golden — authored to the emit rules below, then frozen)
- Modify: `src/index.ts` (export `generateReadClient`)
- Test: `src/codegen/tests/read-client.test.ts` (create)

**Interfaces:**
- Consumes: `Repository`/`FrozenRepository`, `MetaKind`, `effectiveSchema`, `instancesOf`, `termsOf`, `isClass`, `represents`; Task 1 seam; Task 2 naming.
- Produces: `generateReadClient(repo: Repository, options: { name: string; importSpecifier?: string }): string`; `isReferenceType(repo, typeId): boolean`.

**Emit rules (deterministic; everything sorted by id):**

Header:
```
// Generated by @pragmatic-lab/todl read-client codegen. Do not edit.
import { FrozenRepository, EntityBase } from "<importSpecifier>";
```
Package class (name = `pascalCase(options.name)`):
```
export class <Pascal(name)> extends FrozenRepository {
  protected override createEntity(id: string): EntityBase {
    switch (this.resolve(id)?.typeOf) {
<for each concept c, sorted>      case "<c>": return new <Pascal(c)>(this, id);
      default: return super.createEntity(id);
    }
  }
<for each concept c, sorted>
  get <pluralize(camel(c))>(): readonly <Pascal(c)>[] {
    return this.instancesOf("<c>").filter((id) => !this.isClass(id)).map((id) => this.entity(id) as <Pascal(c)>);
  }
<for each taxonomy t, sorted>
  get <camel(t)>(): readonly <Pascal(represents(t)[0])>[] {
    return this.termsOf("<t>").map((id) => this.entity(id) as <Pascal(represents(t)[0])>);
  }
}
```
Entity class per concept c (members from `effectiveSchema(c)`, fields then relationships, each sorted by name):
```
export class <Pascal(c)> extends EntityBase {
<scalar field f>  get <camel(f.name)>(): <tsType(f)> { return this.field("<f.name>") as <tsScalar>; }
<ref field/rel r, cardinality single>  get <camel(r.name)>(): <Pascal(targetConcept)> | undefined { return this.ref("<r.name>") as <Pascal(targetConcept)> | undefined; }
<ref field/rel r, cardinality many>  get <camel(r.name)>(): readonly <Pascal(targetConcept)>[] { return this.refs("<r.name>") as <Pascal(targetConcept)>[]; }
}
```
- `tsScalar` = `string` for now (all TODL scalars surface as `string | number | boolean`; emit `string` for string-based primitives, else `string | number | boolean`). Keep v1 simple: scalar getters return `string` (the fixtures use string labels); a primitive whose base is `integer`/`boolean` → `number`/`boolean`. Resolve via the primitive node's base if present, else `string`.
- `targetConcept` for a reference field = the field's `type`; for a relationship = its `target`. For a taxonomy-typed field, the target Pascal is the taxonomy's represented concept (`represents(type)[0]`) so the getter returns the concept type (terms are that concept).

- [ ] **Step 1: Write the golden fixture (the intended output) + the failing tests**

Create `src/codegen/tests/fixtures/tech-catalog.generated.ts` by hand, exactly matching the emit rules for the fixture graph defined in the test below (billing/location/technology concepts, a `stack` taxonomy, instances). Use a **relative import** so tsx resolves it in-repo:

```ts
// Generated by @pragmatic-lab/todl read-client codegen. Do not edit.
import { FrozenRepository, EntityBase } from "../../../index.js";

export class TechCatalog extends FrozenRepository {
  protected override createEntity(id: string): EntityBase {
    switch (this.resolve(id)?.typeOf) {
      case "billing": return new Billing(this, id);
      case "location": return new Location(this, id);
      case "technology": return new Technology(this, id);
      default: return super.createEntity(id);
    }
  }

  get billings(): readonly Billing[] {
    return this.instancesOf("billing").filter((id) => !this.isClass(id)).map((id) => this.entity(id) as Billing);
  }

  get locations(): readonly Location[] {
    return this.instancesOf("location").filter((id) => !this.isClass(id)).map((id) => this.entity(id) as Location);
  }

  get technologies(): readonly Technology[] {
    return this.instancesOf("technology").filter((id) => !this.isClass(id)).map((id) => this.entity(id) as Technology);
  }

  get stack(): readonly Technology[] {
    return this.termsOf("stack").map((id) => this.entity(id) as Technology);
  }
}

export class Billing extends EntityBase {
  get label(): string { return this.field("label") as string; }
}

export class Location extends EntityBase {
  get label(): string { return this.field("label") as string; }
}

export class Technology extends EntityBase {
  get label(): string { return this.field("label") as string; }
  get availableIn(): readonly Location[] { return this.refs("available-in") as Location[]; }
  get billing(): Billing | undefined { return this.ref("billing") as Billing | undefined; }
}
```

Create `src/codegen/tests/read-client.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Repository } from "../../model/model.js";
import { toJSON } from "../../emit/json.js";
import { FrozenRepository } from "../../model/frozen.js";
import { generateReadClient } from "../read-client.js";
import { TechCatalog } from "./fixtures/tech-catalog.generated.js";

// billing/location/technology concepts + a `stack` taxonomy + instances.
function catalogRepo(): Repository {
  const r = new Repository();
  const b = r.builder();
  b.definePrimitive("string");
  b.defineConcept("billing");
  b.addField("billing", "label", "string");
  b.defineConcept("location");
  b.addField("location", "label", "string");
  b.defineConcept("technology");
  b.addField("technology", "label", "string");
  b.addField("technology", "billing", "billing", /* Optional */ 1);
  b.addField("technology", "available-in", "location", /* Many */ 2);
  b.defineTaxonomy("stack", ["technology"], [{ id: "m365", attrs: new Map([["label", "M365"]]) }]);
  b.assertInstance("billing", "subscription");
  b.setField("subscription", "label", "Subscription");
  b.assertInstance("location", "westeurope");
  b.setField("westeurope", "label", "West Europe");
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.addRelationship("copilot", "billing", "subscription");
  b.addRelationship("copilot", "available-in", "westeurope");
  b.commit();
  return r;
}

test("generateReadClient reproduces the golden fixture byte-for-byte", () => {
  const golden = readFileSync(
    fileURLToPath(new URL("./fixtures/tech-catalog.generated.ts", import.meta.url)),
    "utf8",
  );
  const out = generateReadClient(catalogRepo(), { name: "tech-catalog", importSpecifier: "../../../index.js" });
  assert.equal(out, golden);
});

test("the generated client compiles and runs with typed navigation", () => {
  const catalog = TechCatalog.fromJSON(toJSON(catalogRepo()));
  assert.deepEqual(catalog.technologies.map((t) => t.label), ["Copilot"]);
  const copilot = catalog.technologies[0]!;
  assert.equal(copilot.billing!.label, "Subscription");
  assert.deepEqual(copilot.availableIn.map((l) => l.label), ["West Europe"]);
  assert.deepEqual(catalog.stack.map((t) => t.label), ["M365"]);
  // reference resolves to the shared identity-map handle
  assert.equal(copilot.availableIn[0], catalog.locations[0]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/codegen/tests/read-client.test.ts`
Expected: FAIL — cannot resolve `../read-client.js` (generator missing). The golden-runs test may pass already (the fixture is hand-written and valid) — that is fine; the generate-matches test drives the implementation.

- [ ] **Step 3: Implement `src/codegen/read-client.ts`**

Implement `generateReadClient` to emit exactly the golden format (header, package class with sorted `createEntity` cases + sorted concept collection getters + sorted taxonomy getters, then one entity class per concept with fields-then-relationships getters sorted by name). Classify each field via `isReferenceType`:

```ts
import { MetaKind } from "../model/kinds.js";
import { Cardinality, type NodeId } from "../model/graph.js";
import { Repository } from "../model/model.js";
import { pascalCase, camelCase, pluralize, allocateNames } from "./naming.js";

export function isReferenceType(repo: Repository, typeId: string): boolean {
  const kind = repo.resolve(typeId)?.typeOf;
  return kind === MetaKind.Concept || kind === MetaKind.Taxonomy;
}
// ... build sorted concept/taxonomy lists, run allocateNames(concepts, pascalCase) to
// force collision checks, then assemble the string per the emit rules. Reference target
// Pascal = for a concept-typed member its type; for a taxonomy-typed member
// represents(type)[0]; for a relationship its target. Scalar TS type from the primitive
// base (string|number|boolean), default "string".
```

Finalize the exact string assembly so Step 4 matches the golden. (During execution: run the generator, diff against the golden, and reconcile — the golden is the spec of the output.)

Add to `src/index.ts`:
```ts
export { generateReadClient } from "./codegen/read-client.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/codegen/tests/read-client.test.ts`
Expected: PASS (both tests) — generator output equals the golden, and the golden runs.

- [ ] **Step 5: Full suite + typecheck + build**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`, then `npm run typecheck`, then `npm run build`
Expected: whole suite green; typecheck clean (the golden fixture `.ts` is type-checked); build exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/codegen/read-client.ts src/codegen/tests/fixtures/tech-catalog.generated.ts src/codegen/tests/read-client.test.ts src/index.ts
git commit -m "feat(codegen): generate typed read clients (package class + entity classes) (Component C complete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done-when

- `generateReadClient(repo, { name })` emits a package class (`extends FrozenRepository`, `createEntity` registry, per-concept + per-taxonomy collection accessors) and one typed entity class per concept (scalar + reference getters).
- A committed golden `.ts` fixture is reproduced byte-for-byte by the generator AND imported+exercised (typed navigation returns shared identity-map handles).
- `generateReadClient` is exported; whole suite green, typecheck clean, build emits the new `codegen` module.
- The `createEntity` seam is additive (default unchanged); Phase 1/2 behaviour intact.
- Deferred (do NOT do here): entity-class hierarchy mirroring concept `extends` (spec-optional); cross-base composition inside the generator (caller composes); `ModelDraft`/authoring codegen/`GraphStore` (Phases 4–7).
