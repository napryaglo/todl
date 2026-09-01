# Legacy EA → TODL Migration (test_project) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the legacy enterprise-architecture meta-model (23 concepts, 18 enums, 1 descriptor) and the one active architecture model (`ai-enabled-composable-landscape`, 633 lines) into `test_migration/` as a TODL `test_project`, proving TODL can **load → validate → emit** the real content — no rendering.

**Architecture:** Two workstreams feed the migration. (1) **Grow TODL's parser** to cover the EA authoring grammar the BPMN fixtures never exercised — nested container instances, edge-shorthand records, string-keyed ids, `|`-composed values, object-typed fields. (2) **Build the §9 automated rewriter** that mechanically transforms legacy surface tokens (`@`→`&`, `[0..1]`→`?`, `list<T>`→`T[]`, strips doc-only members, downgrades `formal` invariants). Then run rewriter over the corpus, load+validate under TODL, build the missing model-module emitter, and emit `enterprise-architecture.js` + `<model>.compiled.model.js` into the test_project.

**Tech Stack:** TypeScript (ESM, NodeNext, strict), `node:test` via `tsx --conditions=development`, `@pragmatic-tech-ai/todl`.

## Global Constraints

- **Scope is TODL-only.** Success = the model + meta emit as valid JS modules that `node --check` accepts. NOT in scope: `.view` / `.mural` / manifest (Mural's compilers) or rendering in Plexus.
- **Enums over string-literal union types.** Every discriminant is a real `enum` with explicit string values for wire-facing ones. No `"a" | "b"` types.
- **Don't invent inputs.** The legacy EA sources and the architecture model are canonical and hand-authored. Copy them verbatim as the migration input; never hand-edit a legacy source or fabricate a substitute. Rewriter output is reviewed by Eugene before it is treated as canonical.
- **Lowercase kebab-case identifiers** throughout (`[a-z][a-z0-9]*(?:-[a-z0-9]+)*`); quoted strings for anything that must carry other characters.
- **Reference sigils:** `&` = record reference, `@` = resource resolution. Legacy `@` used for references migrates to `&`.
- **Tests live in `tests/` subfolders** next to the code under test; relative imports use `.js` extensions.
- **Commit messages** end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Branch off `runtime-core`; do not work on a default branch.

## File Structure

```
test_migration/                              # repo-root target (outside TODL git)
  legacy-source/                             # Phase 0: verbatim copies of the legacy corpus (read-only reference)
    meta-models/enterprise-architecture/     #   23 concepts + 18 enums + meta-model.todl
    models/ai-enabled-composable-landscape.architecture.model
  test_project/                              # migrated, new-surface TODL (rewriter output, reviewed)
    meta-models/enterprise-architecture/
    models/ai-enabled-composable-landscape.todl
    dist/                                    # Phase 5 emitter output
      enterprise-architecture.js
      ai-enabled-composable-landscape.compiled.model.js

TODL/src/
  parse/parser.ts        # grows: nested instances, edge-shorthand, string ids, |-values, object types
  parse/ast.ts           # new node shapes for the above
  parse/loader.ts        # containment edges, connector/step edge records
  emit/js-module.ts      # + toModelModule() (the missing instance emitter)
  migrate/rewriter.ts    # NEW subsystem: legacy surface → new surface (§9)
  migrate/tests/
```

---

## Phase 0 — Lock the migration inputs

### Task 0: Copy the legacy corpus into `test_migration/legacy-source/` verbatim

**Files:**
- Create: `test_migration/legacy-source/meta-models/enterprise-architecture/**` (copy of `legacy-development/adl/meta-models/enterprise-architecture/`)
- Create: `test_migration/legacy-source/models/ai-enabled-composable-landscape.architecture.model` (copy)

- [ ] **Step 1: Copy the EA meta-model tree**

```bash
SRC=legacy-development/adl/meta-models/enterprise-architecture
DST=test_migration/legacy-source/meta-models/enterprise-architecture
mkdir -p "$DST" && cp -r "$SRC/." "$DST/"
```

- [ ] **Step 2: Copy the architecture model**

```bash
mkdir -p test_migration/legacy-source/models
cp legacy-development/pilot_project/models/ai-enabled-composable-landscape/ai-enabled-composable-landscape.architecture.model \
   test_migration/legacy-source/models/
```

- [ ] **Step 3: Verify byte-identical copies**

Run: `diff -r legacy-development/adl/meta-models/enterprise-architecture test_migration/legacy-source/meta-models/enterprise-architecture`
Expected: no output (identical). These are the canonical inputs; never edit them.

- [ ] **Step 4: Commit** — `chore(migrate): snapshot legacy EA corpus as migration input`

---

## Phase 1 — Grow the parser to the EA grammar

Each task lands a grammar feature the EA content needs, TDD-first, using **snippets drawn from the real corpus** (not invented). Order matters: later tasks build on the AST/loader hooks earlier ones add.

### Task 1: `|`-composed values in instance assignments

**Files:**
- Modify: `TODL/src/parse/ast.ts` — add `CompositeValue`
- Modify: `TODL/src/parse/parser.ts` — `parseValue` consumes trailing `| ident` runs
- Modify: `TODL/src/parse/loader.ts` — `applyValue` writes a composite as the legacy `"a | b | c"` string
- Test: `TODL/src/parse/tests/parser.test.ts`, `loader.test.ts`

**Interfaces:**
- Produces: `ValueKind.Composite` with `parts: string[]`; loader stores `setField(id, name, parts.join(" | "))` (matches the legacy `type.has()` split on `/[|+,]/`).

- [ ] **Step 1: Failing parser test**

```ts
test("parses a |-composed enum-flag value", () => {
  const ns = parse(`namespace d { location on-prem { type = physical | on-premises | logical-grouping; } }`);
  const inst = ns.declarations[0] as InstanceDecl;
  const value = inst.assignments[0]!.value;
  assert.equal(value.kind, ValueKind.Composite);
  assert.deepEqual((value as CompositeValue).parts, ["physical", "on-premises", "logical-grouping"]);
});
```

- [ ] **Step 2: Run — FAIL** (`ValueKind.Composite` undefined). `npm test`
- [ ] **Step 3: Implement** — add the AST node; in `parseValue`, after reading a `Name`, if the next token is `Pipe`, keep consuming `| <ident>` into a `parts` array and return a `CompositeValue`.
- [ ] **Step 4: Loader test** — `applyValue` on a composite writes `"physical | on-premises | logical-grouping"` as the scalar field. Assert via `model.resolve(id)?.attrs.get("type")`.
- [ ] **Step 5: Run — PASS**, `npx tsc --noEmit` clean
- [ ] **Step 6: Commit** — `feat(parse): |-composed enum-flag values`

### Task 2: String-keyed record ids

**Files:**
- Modify: `TODL/src/parse/parser.ts` — `parseInstance` accepts a `String` token where an identifier id is expected
- Test: `TODL/src/parse/tests/parser.test.ts`

**Interfaces:**
- Produces: `InstanceDecl.id` may be a slugified/quoted string; store the raw string as the id.

- [ ] **Step 1: Failing test** — `parse('namespace d { sequence "Conversation via M365 Copilot" { } }')` yields an `InstanceDecl` with `id === "Conversation via M365 Copilot"`.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** — in `parseInstance`, read the id via a helper that accepts `Identifier` or `String`.
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `feat(parse): string-keyed record ids`

### Task 3: Nested container instances + containment edges

**Files:**
- Modify: `TODL/src/parse/ast.ts` — `InstanceDecl.children: InstanceDecl[]`
- Modify: `TODL/src/parse/parser.ts` — `parseInstance` recognizes a nested `<concept> <id> { … }` inside a body and recurses
- Modify: `TODL/src/parse/loader.ts` — emit an `EdgeKind.Contains` edge parent→child
- Test: `TODL/src/parse/tests/parser.test.ts`, `loader.test.ts`

**Interfaces:**
- Consumes: `EdgeKind.Contains` (already in `graph.ts`).
- Produces: nested `InstanceDecl` children; loader attaches each child and a `Contains` edge from the enclosing instance.

- [ ] **Step 1: Failing test** — using the real `model … { location … {…} }` shape:

```ts
test("parses nested container instances", () => {
  const ns = parse(`namespace d {
    model m : enterprise-architecture {
      title = "T";
      location saas-3p { label = "3rd-Party SaaS"; type = logical-grouping; }
    }
  }`);
  const model = ns.declarations[0] as InstanceDecl;
  assert.equal(model.concept, "model");
  assert.equal(model.children.length, 1);
  assert.equal(model.children[0]!.concept, "location");
});
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** — in `parseInstance`, inside the body loop, when the lookahead is `Identifier Identifier {` (or `Identifier String {`), parse a nested `InstanceDecl` instead of an assignment. Distinguish assignment (`name =`) from nested record (`concept id {`) by the token after the first identifier.
- [ ] **Step 4: Loader test** — after `load`, the child `saas-3p` exists as an instance and `model.related("m", EdgeKind.Contains, Direction.Out)` includes `saas-3p`.
- [ ] **Step 5: Run — PASS**, tsc clean
- [ ] **Step 6: Commit** — `feat(parse): nested container instances + contains edges`

### Task 4: Edge-shorthand records (`connector`/`step`/`-->`)

**Files:**
- Modify: `TODL/src/parse/ast.ts` — `EdgeRecordDecl { concept, from, to, operator, assignments, id? }`
- Modify: `TODL/src/parse/parser.ts` — recognize `<concept> &from -> &to [ { … } ]` and bare `&from --> &to` inside an `application-connectors { }` block
- Modify: `TODL/src/parse/loader.ts` — materialize as an instance carrying `from`/`to` relationship edges (matching the legacy `connector`/`sequence-step` records)
- Test: `parser.test.ts`, `loader.test.ts`

**Interfaces:**
- Produces: `EdgeRecordDecl`; loader asserts an instance (auto-id when none) of the named concept and adds `from`/`to` relationships to the two referenced records. The operator (`->`, `-->`) is stored as an attr for downstream shaping.

- [ ] **Step 1: Failing test** — real corpus lines:

```ts
test("parses connector edge-shorthand with a body", () => {
  const ns = parse(`namespace d { connector &business-agent -> &agent-orchestrator { type = enabled-by; } }`);
  const edge = ns.declarations[0] as EdgeRecordDecl;
  assert.equal(edge.concept, "connector");
  assert.equal(edge.from, "business-agent");
  assert.equal(edge.to, "agent-orchestrator");
});

test("parses step edge-shorthand without a body", () => {
  const ns = parse(`namespace d { scenario s { sequence "x" { step &a -> &b; } } }`);
  // step lives two levels deep; assert it resolves to an EdgeRecordDecl child
});
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** — after reading a leading concept identifier, if the next token is `Amp` (a `&ref`) followed eventually by `Arrow`/a double-arrow, parse an `EdgeRecordDecl`. Add the double-arrow (`-->`) token to the lexer if absent. `application-connectors { … }` is a bodyless block of bare `&a --> &b` edges.
- [ ] **Step 4: Loader test** — the connector instance exists and `model.related(connectorId, EdgeKind.Relationship, Direction.Out, "from")` = `["business-agent"]`, `"to"` = `["agent-orchestrator"]`.
- [ ] **Step 5: Run — PASS**, tsc clean
- [ ] **Step 6: Commit** — `feat(parse): edge-shorthand connector/step records`

### Task 5: Object-typed fields in the ontology (`component.slots`)

**Files:**
- Modify: `TODL/src/parse/ast.ts` — `FieldDecl.type` may be an `ObjectType { fields: FieldDecl[] }`
- Modify: `TODL/src/parse/parser.ts` — field-type parser accepts `object { … }` (and, post-rewrite, `object { … }[]`)
- Modify: `TODL/src/model/builder.ts` / `model.ts` — store an object field's inner shape (JSON-encoded on the field node's `type` attr, or a nested schema)
- Test: `parser.test.ts`

**Interfaces:**
- Produces: object-typed field schema. For TODL-only emit, the inner shape must **parse and round-trip through emit**; deep per-slot validation is out of scope for this phase (note the limitation in the emitter output).

- [ ] **Step 1: Failing test** — `component.slots` reduced to the real inner shape (`id`, `label`, `environment`, `in-resource-group?`, `public-ingress[]`).
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** — recursive field-type parse; encode the object type as `object { … }` inline-form string on the field (matching the legacy `_inline_type` the emitter already renders).
- [ ] **Step 4: Run — PASS**, tsc clean
- [ ] **Step 5: Commit** — `feat(parse): object-typed ontology fields`

> **Heads-up:** Task 5 is the heaviest grammar addition and the least-used feature (one concept). If load+validate of everything else passes and only `slots` blocks it, an acceptable fallback is to have the rewriter downgrade `slots` to an opaque `text` field and record the loss in the migration report — decide when you get there, don't pre-optimize.

---

## Phase 2 — The §9 automated rewriter

### Task 6: Rewriter core — mechanical surface transforms

**Files:**
- Create: `TODL/src/migrate/rewriter.ts`
- Create: `TODL/src/migrate/tests/rewriter.test.ts`
- Modify: `TODL/src/index.ts` — export `rewrite`

**Interfaces:**
- Produces: `export function rewrite(legacySource: string): string`. Pure string→string over one file. Transforms, each independently tested:
  1. `@<ident>` → `&<ident>` (reference sigil), leaving `@resource`-style paths untouched only if any exist (none in this corpus — verify).
  2. `[0..1]` → `?`; `[*]` → `[]`; `[1..*]` → `[+]`; `[1]` → *(removed)*.
  3. `list<T>` → `T[]` (compose with #2 when a trailing `[*]` follows).
  4. Strip `authoring <name> { … }` blocks and concept-level `references = [ … ];`.
  5. Invariant `{ description = "…"; formal = "…"; }` → `invariant "…";` (prose-only; `formal` dropped — TODL's predicate language does not cover the `∀ … ∈` notation).
  6. `meta-model <id> { … }` descriptor → dropped from the loadable output; its `root-concept` captured into a returned sidecar (see Task 7).

- [ ] **Step 1: Failing test per transform** — one `test()` each, e.g.:

```ts
test("rewrites @ref to &ref", () => {
  assert.equal(rewrite("in = @m365;"), "in = &m365;");
});
test("rewrites [0..1] cardinality to ?", () => {
  assert.equal(rewrite("implemented-by : identifier [0..1];"), "implemented-by : identifier?;");
});
test("rewrites list<T> [*] to T[]", () => {
  assert.equal(rewrite("realised-by : list<technology> [*];"), "realised-by : technology[];");
});
test("downgrades a formal invariant to prose", () => {
  const out = rewrite(`invariant { description = "Ids unique."; formal = "∀ c ∈ …"; }`);
  assert.match(out, /invariant "Ids unique\.";/);
  assert.doesNotMatch(out, /formal/);
});
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** each transform minimally to pass its test.
- [ ] **Step 4: Run — PASS**, tsc clean
- [ ] **Step 5: Commit** — `feat(migrate): §9 rewriter — mechanical surface transforms`

### Task 7: Rewriter driver + faithfulness harness

**Files:**
- Create: `TODL/src/migrate/run.ts` — CLI-ish driver: read a legacy tree, write the rewritten tree, capture the meta-model `root-concept`
- Create: `TODL/src/migrate/tests/faithfulness.test.ts`

**Interfaces:**
- Consumes: `rewrite` (Task 6), `load` + `validate` (existing).
- Produces: rewritten files under `test_migration/test_project/`; a `{ rootConcept }` capture for emit.
- **Faithfulness definition (this phase):** since running the legacy Python compiler is out of band, faithfulness = the rewritten corpus **loads with zero parser errors, zero unexpected `unresolved` placeholders, and zero validation errors**, and the load produces the expected concept/enum/instance counts. Eugene reviews the rewritten diff before it is canonical.

- [ ] **Step 1: Failing harness test** — load the *rewritten* EA meta-model, assert 23 concepts + 18 enums resolve (no `unresolved`), `validate()` returns `[]`.
- [ ] **Step 2: Run — FAIL** (driver not written)
- [ ] **Step 3: Implement** the driver; iterate rewriter transforms until the harness passes.
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `feat(migrate): rewriter driver + faithfulness harness`

---

## Phase 3 — Migrate + validate the meta-model

### Task 8: Produce and validate the migrated EA meta-model

**Files:**
- Create: `test_migration/test_project/meta-models/enterprise-architecture/**` (rewriter output, reviewed)
- Test: `TODL/src/migrate/tests/ea-meta.test.ts`

- [ ] **Step 1: Run the driver** over `legacy-source/meta-models/enterprise-architecture/` → `test_project/meta-models/enterprise-architecture/`.
- [ ] **Step 2: Failing test** — `load([...all migrated meta files])`, assert every one of the 23 named concepts resolves (spot-check `component`, `connector`, `technology`, `scenario`), all 18 enums present, `validate()` clean.
- [ ] **Step 3: Triage** any failure as *rewriter bug* vs *parser gap* vs *genuine content issue*; fix at the right layer (return to Phase 1/2 tasks, never patch the legacy source).
- [ ] **Step 4: Run — PASS**; **Eugene reviews** the migrated tree before commit.
- [ ] **Step 5: Commit** — `feat(migrate): migrated + validated EA meta-model`

---

## Phase 4 — Migrate + validate the model

### Task 9: Produce and validate the migrated architecture model

**Files:**
- Create: `test_migration/test_project/models/ai-enabled-composable-landscape.todl` (rewriter output, reviewed)
- Test: `TODL/src/migrate/tests/ea-model.test.ts`

- [ ] **Step 1: Run the driver** over the 633-line model.
- [ ] **Step 2: Failing test** — `load([...meta, migrated model])`, assert the top-level `model` record contains its locations/components/scenarios (via `Contains` edges), spot-check a component's `in`/`category`/`implemented-by`, then `validate()`.
- [ ] **Step 3: Triage diagnostics** — the EA invariants that survived as prose won't execute (expected); cardinality + relationship-target checks should pass. Any real miss is a rewriter/parser bug. Record intentionally-external unresolved refs (library ids like `@azure`, `@m365` that live in `technology_library/`) — decide whether to stub them or accept placeholders, and **log the decision in the migration report** (no silent tolerance).
- [ ] **Step 4: Run — PASS**; Eugene reviews.
- [ ] **Step 5: Commit** — `feat(migrate): migrated + validated EA model`

---

## Phase 5 — Build the model-module emitter + emit the test_project

### Task 10: `toModelModule()` — the instance emitter

**Files:**
- Modify: `TODL/src/emit/js-module.ts` — add `toModelModule`
- Modify: `TODL/src/index.ts` — export it
- Test: `TODL/src/emit/tests/js-module.test.ts`

**Interfaces:**
- Consumes: a loaded `Model`, the `rootConcept` + registry name from Phase 2/3.
- Produces: `export function toModelModule(model, options: ModelModuleOptions): string` emitting the legacy `.compiled.model.js` shape:
  ```js
  import { enterpriseArchitecture as meta } from "<metaImport>";
  const elements = {};
  elements["id"] = meta.constructors.<kind>({ …scalar attrs, refs as ids… });
  export const model = { meta: { id, metaModel, title }, elements, get(id) { return this.elements[id] ?? null; } };
  ```
  Generic core only. **EA-specific `categories`/`flows`/`scenarios`/`getCategory` are deliberately out of the domain-agnostic emitter** — note their absence in the module header; if Plexus requires them, they become a follow-up EA-specialization pass (see Phase 6).

**ModelModuleOptions:**
```ts
export interface ModelModuleOptions {
  metaImport: string;    // relative import to the emitted meta module
  metaRegistry: string;  // e.g. "enterpriseArchitecture"
  rootConcept: string;   // the container record whose meta becomes model.meta
}
```

- [ ] **Step 1: Failing test** — emit from the migrated corpus, assert:

```ts
const js = toModelModule(model, { metaImport: "./enterprise-architecture.js", metaRegistry: "enterpriseArchitecture", rootConcept: "model" });
assert.match(js, /import \{ enterpriseArchitecture as meta \} from "\.\/enterprise-architecture\.js";/);
assert.match(js, /elements\["saas-3p"\] = meta\.constructors\.location\(\{/);
assert.match(js, /export const model = \{/);
assert.match(js, /get\(id\) \{ return this\.elements\[id\] \?\? null; \}/);
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** — walk instance-tier nodes (excluding the container + ontology tiers), render `meta.constructors.<typeOf>({ attrs + outgoing relationship targets as ids })`; render the container's own attrs into `model.meta`.
- [ ] **Step 4: Run — PASS**, tsc clean
- [ ] **Step 5: Commit** — `feat(emit): model-module emitter (.compiled.model.js)`

### Task 11: Emit the test_project dist + `node --check`

**Files:**
- Create: `test_migration/test_project/dist/enterprise-architecture.js`
- Create: `test_migration/test_project/dist/ai-enabled-composable-landscape.compiled.model.js`
- Test: `TODL/src/migrate/tests/emit.test.ts`

- [ ] **Step 1: Emit** both modules from the loaded migrated corpus (`toMetaModule` with `rootConcept: "model"`, `toModelModule`).
- [ ] **Step 2: Failing test** — assert both files write and are non-empty; the model module imports the meta module by the emitted relative path.
- [ ] **Step 3: Syntax gate** — `node --check` both emitted files. Expected: exit 0.
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `feat(migrate): emit test_project dist (meta + model modules)`

---

## Phase 6 — Reconcile with Plexus (investigation, may spawn follow-up)

### Task 12: Diff the emitted shape against Plexus's real loader

**Files:**
- Read-only: locate Plexus's architecture-repository / model loader
- Create: `test_migration/MIGRATION-REPORT.md` — what migrated cleanly, what downgraded (formal invariants, object slots if downgraded, external library refs), and any delta between the emitted module shape and what Plexus actually consumes

- [ ] **Step 1: Find** Plexus's loader (the code that `import()`s a `.compiled.model.js` / `*.js` meta module and mounts it).
- [ ] **Step 2: Compare** its expected exports/fields against the emitted modules. Note every divergence (does it read `categories`/`flows`/`scenarios`? typed refs vs bare strings? registry name?).
- [ ] **Step 3: Write** `MIGRATION-REPORT.md` — the honest ledger: fidelity kept, fidelity lost, and the gap (if any) to a Plexus-loadable module. This decides whether an EA-specialization emit pass is the next plan.
- [ ] **Step 4: Commit** — `docs(migrate): migration report + Plexus reconciliation`

---

## Self-Review

- **Spec coverage:** §9 rewriter (Tasks 6–7), faithfulness test (Task 7), three-shapes emit incl. the missing model module (Tasks 10–11), success-criterion "every hand-authored record parses and validates" (Tasks 8–9). §7.3 meta module already shipped.
- **Known deferrals (called out, not hidden):** deep per-slot validation of object-typed fields (Task 5 note); executable EA invariants — the `formal` blocks downgrade to prose because TODL's predicate language doesn't cover `∀ … ∈` set-builder notation (Task 6.5); EA-specific `categories`/`flows`/`scenarios` in the model module (Task 10) — pending the Plexus reconciliation in Task 12.
- **Type consistency:** `EdgeRecordDecl`, `CompositeValue`, `InstanceDecl.children`, `toModelModule`/`ModelModuleOptions`, `rewrite` are used with the same names/signatures across the tasks that produce and consume them.
- **No legacy edits:** every triage step fixes the rewriter or parser, never the canonical source.

## Execution Handoff

Plan saved to `TODL/docs/superpowers/plans/2026-07-16-legacy-ea-migration.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
