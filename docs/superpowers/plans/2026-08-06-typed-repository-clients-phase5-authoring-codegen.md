# Typed Repository Clients — Phase 5: Authoring-Constructor Codegen (Component E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the read-client generator to also emit, on the same package class, a stateless typed **authoring constructor** per concept — `catalog.technology(id, { label, availableIn, billing })` → `InstanceDescriptor` — so a user authors a model with full type-safety and feeds the result straight to `ModelDraft.add`, completing the `draft.add(client.component(id, {…}))` loop.

**Architecture:** Additive to the Phase 3 generator (`generateReadClient`). After the collection accessors, the package class gains one method per concept: `<camelConcept>(id, fields): InstanceDescriptor`. Reference params are typed by the meta-model entity class (concept-typed field → that concept's class; taxonomy-typed field → its represented-concept class, same rule Phase 3 uses on the read side); the method extracts `.id` from each passed `Entity` into a `refs` map, and scalar params into a `scalars` map, shaped by cardinality (required / optional / array). The emitted `InstanceDescriptor` is exactly what `ModelDraft.add` (Phase 4) consumes — so authoring is typed end-to-end with no new runtime.

**Tech Stack:** TypeScript (ESM, strict), Node's built-in test runner via `tsx`.

## Global Constraints

- **This plan is Phase 5 of 7** (spec §14). Builds Component E (spec §8). Do NOT build the `GraphStore` seam (Phase 6) or Cypher (Phase 7).
- **Constructors live on the generated package class** (spec §8: "scoped to the meta-model client"), emitted by extending `generateReadClient` — one unified client with read accessors AND authoring constructors. The Phase 3 golden fixture is updated to include them; its byte-match test then covers authoring too.
- **The library is not a type parameter** (spec §8). A reference param's type is the meta-model entity class: concept-typed field → `pascalCase(field.type)`; taxonomy-typed field → `pascalCase(represents(type)[0])`; relationship → `pascalCase(target)`. Same target resolution as Phase 3.
- **Scalar vs reference and cardinality** (spec §8): primitive field → scalar param (value → `scalars`); concept/taxonomy field + relationship → entity param (value → `refs` via `.id`). Cardinality: `One`→required single, `Optional`→optional single, `Many`→optional array, `NonEmpty`→required array. Required members are assigned unconditionally; optional members are guarded by `!== undefined`.
- **v1 scope:** scalar fields are single (`One`/`Optional`). Many-scalar fields (`string[]` as attrs) are out of scope (not representable in the single-value attr map) — the generator must not emit them as scalar params; if encountered it throws. (Not present in the fixture.) References support all cardinalities.
- **Members are ordered** scalars-first then references, each sorted by name — identical to Phase 3, so the entity read getters and the authoring param list stay in the same order.
- **Additive only.** Extending the generator + updating the golden changes no runtime and no existing test's intent (the Phase 3 byte-match test reads the updated golden and still passes).
- **Every test file lives in a `tests/` subfolder.** Use real enums.
- Test: `npx tsx --conditions=development --test "src/**/*.test.ts"`. Typecheck: `npm run typecheck`. Build: `npm run build`.

### Resolved design decisions

1. **Generated header grows a second import line:** `import type { InstanceDescriptor, NodeId, Scalar } from "<importSpecifier>";` (all three are exported from the package root). The value import (`FrozenRepository, EntityBase`) is unchanged.
2. **Authoring methods emit after the taxonomy getters, sorted by concept id.** Each declares `const scalars = new Map<string, Scalar>();` and `const refs = new Map<string, readonly NodeId[]>();`, assigns members, and `return { concept: "<c>", id, scalars, refs };` (both maps are always used by the return, so never "unused").
3. **No `Category` taxonomy class** (Phase 3 didn't generate one): a taxonomy-typed field's param type is the represented concept's class.
4. **The factory is stateless** — it only builds a descriptor; `ModelDraft.add` performs the mutation. It is a method on the frozen client purely for scoping/type-access; it reads no draft state.

### File structure

- `src/codegen/read-client.ts` *(modify)* — emit authoring constructors + the extra header import.
- `src/codegen/tests/fixtures/tech-catalog.generated.ts` *(modify)* — add the authoring methods + header import (the updated golden).
- `src/codegen/tests/authoring.test.ts` *(create)* — end-to-end: authoring constructor → `ModelDraft.add`.

---

## Task 1: Emit authoring constructors + update the golden

**Files:**
- Modify: `src/codegen/read-client.ts`
- Modify: `src/codegen/tests/fixtures/tech-catalog.generated.ts`
- (The existing `src/codegen/tests/read-client.test.ts` byte-match test now guards the authoring output too — no change needed.)

**Interfaces:**
- Consumes: Phase 3 emit machinery (`effectiveSchema`, `isReferenceType`, `targetPascal`, naming utils); the `InstanceDescriptor` shape (Phase 4).
- Produces: authoring methods `<camelConcept>(id: string, fields: {…}): InstanceDescriptor` on the package class.

- [ ] **Step 1: Update the golden fixture (the intended output)**

Edit `src/codegen/tests/fixtures/tech-catalog.generated.ts`: (a) change the header to add the type import; (b) add the three authoring methods to `TechCatalog` after the `stack` getter.

Header (replace the single import line):

```ts
import { FrozenRepository, EntityBase } from "../../../index.js";
import type { InstanceDescriptor, NodeId, Scalar } from "../../../index.js";
```

Inside `class TechCatalog`, after the `get stack()` block and before the closing `}`, add:

```ts

  billing(id: string, fields: {
    label: string;
  }): InstanceDescriptor {
    const scalars = new Map<string, Scalar>();
    const refs = new Map<string, readonly NodeId[]>();
    scalars.set("label", fields.label);
    return { concept: "billing", id, scalars, refs };
  }

  location(id: string, fields: {
    label: string;
  }): InstanceDescriptor {
    const scalars = new Map<string, Scalar>();
    const refs = new Map<string, readonly NodeId[]>();
    scalars.set("label", fields.label);
    return { concept: "location", id, scalars, refs };
  }

  technology(id: string, fields: {
    label: string;
    availableIn?: readonly Location[];
    billing?: Billing;
  }): InstanceDescriptor {
    const scalars = new Map<string, Scalar>();
    const refs = new Map<string, readonly NodeId[]>();
    scalars.set("label", fields.label);
    if (fields.availableIn !== undefined) refs.set("available-in", fields.availableIn.map((e) => e.id));
    if (fields.billing !== undefined) refs.set("billing", [fields.billing.id]);
    return { concept: "technology", id, scalars, refs };
  }
```

- [ ] **Step 2: Run the byte-match test to verify it fails**

Run: `npx tsx --conditions=development --test src/codegen/tests/read-client.test.ts`
Expected: FAIL — the generator (unchanged) no longer reproduces the golden (missing header import + authoring methods).

- [ ] **Step 3: Implement authoring emission in `src/codegen/read-client.ts`**

(a) Update the header in `generateReadClient` to add the type import line:

```ts
  const header =
    `// Generated by @pragmatic-lab/todl read-client codegen. Do not edit.\n` +
    `import { FrozenRepository, EntityBase } from "${importSpecifier}";\n` +
    `import type { InstanceDescriptor, NodeId, Scalar } from "${importSpecifier}";`;
```

(b) In `emitPackageClass`, append per-concept authoring methods after the collection getters. Change the final assembly to include them:

```ts
  const authoring = concepts.map((c) => emitAuthoringConstructor(c, repo));
  const members = [...conceptGetters, ...taxonomyGetters, ...authoring].join("\n\n");
  return `export class ${className} extends FrozenRepository {\n${createEntity}\n\n${members}\n}`;
```

(c) Add `emitAuthoringConstructor`, reusing Phase 3's field classification (scalars-then-refs, sorted by name), the `RefMember` shape, `scalarTsType`, `targetPascal`, `isMany`, `camelCase`:

```ts
function emitAuthoringConstructor(concept: NodeId, repo: Repository): string {
  const schema = repo.effectiveSchema(concept);

  const scalarFields = schema.fields
    .filter((f) => !isReferenceType(repo, f.type))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const f of scalarFields) {
    if (isMany(f.cardinality)) {
      throw new Error(`authoring codegen: many-valued scalar field "${concept}.${f.name}" is unsupported`);
    }
  }

  const refMembers: RefMember[] = [
    ...schema.fields
      .filter((f) => isReferenceType(repo, f.type))
      .map((f) => ({ name: f.name, targetPascal: targetPascal(repo, f.type), many: isMany(f.cardinality) })),
    ...schema.relationships.map((r) => ({
      name: r.name,
      targetPascal: pascalCase(r.target),
      many: isMany(r.cardinality),
    })),
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const required = (card: Cardinality): boolean =>
    card === Cardinality.One || card === Cardinality.NonEmpty;

  const params: string[] = [];
  const assigns: string[] = [];

  for (const f of scalarFields) {
    const opt = required(f.cardinality) ? "" : "?";
    params.push(`    ${camelCase(f.name)}${opt}: ${scalarTsType(f.type)};`);
    const read = `fields.${camelCase(f.name)}`;
    assigns.push(
      required(f.cardinality)
        ? `    scalars.set("${f.name}", ${read});`
        : `    if (${read} !== undefined) scalars.set("${f.name}", ${read});`,
    );
  }

  // Re-derive cardinality per ref member for required/optional (RefMember carries `many`,
  // but required-ness needs the schema entry). Look it up by name.
  const cardOf = (name: string): Cardinality => {
    const field = schema.fields.find((f) => f.name === name);
    if (field !== undefined) return field.cardinality;
    const rel = schema.relationships.find((r) => r.name === name);
    return rel?.cardinality ?? Cardinality.Optional;
  };

  for (const m of refMembers) {
    const opt = required(cardOf(m.name)) ? "" : "?";
    const type = m.many ? `readonly ${m.targetPascal}[]` : m.targetPascal;
    params.push(`    ${camelCase(m.name)}${opt}: ${type};`);
    const read = `fields.${camelCase(m.name)}`;
    const value = m.many ? `${read}.map((e) => e.id)` : `[${read}.id]`;
    assigns.push(
      required(cardOf(m.name))
        ? `    refs.set("${m.name}", ${value});`
        : `    if (${read} !== undefined) refs.set("${m.name}", ${value});`,
    );
  }

  return (
    `  ${camelCase(concept)}(id: string, fields: {\n` +
    `${params.join("\n")}\n` +
    `  }): InstanceDescriptor {\n` +
    `    const scalars = new Map<string, Scalar>();\n` +
    `    const refs = new Map<string, readonly NodeId[]>();\n` +
    `${assigns.join("\n")}\n` +
    `    return { concept: "${concept}", id, scalars, refs };\n` +
    `  }`
  );
}
```

- [ ] **Step 4: Run the byte-match test to verify it passes**

Run: `npx tsx --conditions=development --test src/codegen/tests/read-client.test.ts`
Expected: PASS — generator output equals the updated golden (and the golden still compiles + runs its read test). If the bytes differ, diff the generator output against the golden and reconcile (the golden is the spec of the output).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: whole suite green; typecheck clean (the updated golden `.ts` is type-checked — the authoring methods must be valid TS).

- [ ] **Step 6: Commit**

```bash
git add src/codegen/read-client.ts src/codegen/tests/fixtures/tech-catalog.generated.ts
git commit -m "feat(codegen): emit typed authoring constructors on the generated client

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: End-to-end authoring — constructor → `ModelDraft.add`

**Files:**
- Test: `src/codegen/tests/authoring.test.ts` (create)

**Interfaces:**
- Consumes: the golden `TechCatalog` (its authoring methods), `ModelDraft`, `toJSON`.

- [ ] **Step 1: Write the failing test**

Create `src/codegen/tests/authoring.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { Cardinality } from "../../model/graph.js";
import { toJSON } from "../../emit/json.js";
import { ModelDraft } from "../../authoring/model-draft.js";
import { TechCatalog } from "./fixtures/tech-catalog.generated.js";

// A base with concept schemas + library instances to reference across the boundary.
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
  b.addField("technology", "billing", "billing", Cardinality.Optional);
  b.addField("technology", "available-in", "location", Cardinality.Many);
  b.assertInstance("billing", "subscription");
  b.setField("subscription", "label", "Subscription");
  b.assertInstance("location", "westeurope");
  b.setField("westeurope", "label", "West Europe");
  b.commit();
  return r;
}

test("a typed authoring constructor produces a descriptor ModelDraft.add consumes", () => {
  const base = TechCatalog.fromJSON(toJSON(catalogRepo()));
  const draft = ModelDraft.on([base], { namespace: "app" });

  // Author a new technology referencing frozen base instances — fully typed.
  const descriptor = base.technology("copilot", {
    label: "Copilot",
    billing: base.billings[0],
    availableIn: [base.locations[0]!],
  });
  const copilot = draft.add(descriptor);

  assert.equal(copilot.field("label"), "Copilot");
  assert.equal(copilot.ref("billing")!.id, "subscription");
  assert.deepEqual(copilot.refs("available-in").map((e) => e.id), ["westeurope"]);
});

test("the descriptor shape matches InstanceDescriptor (scalars + refs by id)", () => {
  const base = TechCatalog.fromJSON(toJSON(catalogRepo()));
  const d = base.technology("x", { label: "X", availableIn: [base.locations[0]!] });
  assert.equal(d.concept, "technology");
  assert.equal(d.id, "x");
  assert.equal(d.scalars!.get("label"), "X");
  assert.deepEqual(d.refs!.get("available-in"), ["westeurope"]);
  assert.equal(d.refs!.has("billing"), false); // omitted optional stays absent
});
```

- [ ] **Step 2: Run to verify it (drives nothing new to implement — proves the round-trip)**

Run: `npx tsx --conditions=development --test src/codegen/tests/authoring.test.ts`
Expected: PASS — Task 1 already emitted the authoring methods into the golden; this test proves the constructor → `add` round-trip and the descriptor shape. If it FAILS, the golden's authoring method is wrong — fix it (and re-run the byte-match so the generator stays in sync).

- [ ] **Step 3: Full suite + typecheck + build**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"`, then `npm run typecheck`, then `npm run build`
Expected: whole suite green; typecheck clean; build exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/codegen/tests/authoring.test.ts
git commit -m "test(codegen): end-to-end typed authoring constructor -> ModelDraft.add (Component E complete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done-when

- The generated client carries a typed authoring constructor per concept (`client.<concept>(id, { …fields })`) returning an `InstanceDescriptor`; reference params are entity-typed and reduced to ids; cardinality shapes required/optional/array.
- The updated golden fixture is reproduced byte-for-byte by the generator AND compiles + runs, and its authoring constructor feeds `ModelDraft.add` end-to-end.
- Whole suite green, typecheck clean, build exits 0. No runtime change; the generator extension and golden update are additive.
- Deferred (do NOT do here): many-valued scalar fields; a `draft.<concept>(…)` convenience alias (spec §8 "optional"); the `GraphStore` seam + Cypher (Phases 6–7).
