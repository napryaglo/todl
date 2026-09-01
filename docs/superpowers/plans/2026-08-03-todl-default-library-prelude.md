# TODL Default Library (Prelude) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `src/stdlib/prelude.todl` inside `@pragmatic-tech-ai/todl` that is implicitly injected as the foundation base into every `check`/`checkAgainst`, providing standard primitives, standard annotations, and a universal root concept `element`.

**Architecture:** The prelude is authored in TODL, compiled once (memoized) via the existing *raw* loader (`load`), and injected as the first base by `check`/`checkAgainst` (`mergeBases([prelude, ...bases])`). Because TODL node ids are bare and `mergeBases` seeds them, the prelude names resolve unqualified with no resolver change. A parent-less concept implicitly extends `element`. Redeclaring a prelude name warns.

**Tech Stack:** TypeScript (ESM, strict), Node ≥20, tests via `tsx --conditions=development --test`. Design doc: `docs/superpowers/specs/2026-08-03-todl-default-library-prelude-design.md`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source (`src/stdlib/tests/…`), never beside the source.
- A fixed set of named strings is a TypeScript `enum` — add to `DiagnosticCode`, never a bare string literal at the use site.
- **Non-breaking:** after every task the full suite (`npm test`) must be green. This change adds prelude nodes to every compile, so some existing tests that assert exact node sets/counts must be updated — that is expected, not a failure.
- The prelude is compiled with the RAW loader (`load`), never through the prelude-injecting `check`, or it references itself.
- Prelude namespace is `todl`; its member ids are bare (`identifier`, `element`, …) so they resolve unqualified via base seeding.

---

### Task 1: Prelude source + memoized loader + build packaging

**Files:**
- Create: `src/stdlib/prelude.todl`
- Create: `src/stdlib/prelude.ts`
- Test: `src/stdlib/tests/prelude.test.ts`
- Modify: `package.json` (build copies `stdlib/*.todl` into `dist`)

**Interfaces:**
- Produces: `preludeDocument(): TodlDocument` — the compiled prelude as a base document, memoized. Consumed by Task 2.
- Produces: `PRELUDE_NAMESPACE = "todl"` and `preludeNames(): ReadonlySet<string>` (bare ids the prelude defines) — consumed by Task 4.

- [ ] **Step 1: Write the prelude source** `src/stdlib/prelude.todl`

```todl
namespace todl
{
    // Standard primitives — stop redeclaring these in every meta-model.
    primitive identifier : string { regex = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"; }
    primitive slug       : string { regex = "^[a-z0-9]+(?:-[a-z0-9]+)*$"; }
    primitive label      : string { }

    // Standard annotations.
    annotation icon     { path    : string?; }
    annotation toolbox  { visible : boolean?; }
    annotation instance { concept : identifier; via : identifier?; }

    // Universal root concept — implicit supertype of every parent-less concept.
    concept element
    {
        label       : label?;
        description : string?;
    }
}
```

- [ ] **Step 2: Write the failing test** `src/stdlib/tests/prelude.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { preludeDocument, preludeNames } from "../prelude.js";

test("prelude compiles with no diagnostics and carries the standard nodes", () => {
  const doc = preludeDocument();
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const id of ["identifier", "slug", "label", "icon", "toolbox", "instance", "element"]) {
    assert.ok(ids.has(id), `prelude is missing "${id}"`);
  }
});

test("preludeNames lists exactly the prelude-defined bare ids", () => {
  const names = preludeNames();
  for (const id of ["identifier", "slug", "label", "icon", "toolbox", "instance", "element"]) {
    assert.ok(names.has(id), `preludeNames missing "${id}"`);
  }
});
```

- [ ] **Step 3: Run it to confirm it fails** — `npm test` (module `../prelude.js` not found).

- [ ] **Step 4: Implement** `src/stdlib/prelude.ts`

```ts
import { readFileSync } from "node:fs";
import { load } from "../parse/loader.js";
import { toJSON, type TodlDocument } from "../emit/json.js";

export const PRELUDE_NAMESPACE = "todl";

// Resolves to src/stdlib/prelude.todl under tsx (dev) and dist/stdlib/prelude.todl
// when packaged (the build copies the .todl beside the compiled module).
const PRELUDE_URL = new URL("./prelude.todl", import.meta.url);

let cached: TodlDocument | undefined;
let cachedNames: ReadonlySet<string> | undefined;

/** The compiled prelude as a base document, memoized. Compiled with the RAW
 *  loader (never `check`) so it does not reference itself. Throws if the
 *  prelude itself is malformed — a build/authoring error, not a user one. */
export function preludeDocument(): TodlDocument {
  if (cached !== undefined) return cached;
  const text = readFileSync(PRELUDE_URL, "utf8");
  const { model, diagnostics } = load([{ uri: "todl:prelude", text }]);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    throw new Error(`TODL prelude failed to compile: ${errors.map((d) => d.message).join("; ")}`);
  }
  cached = toJSON(model);
  return cached;
}

/** The bare ids the prelude defines — used to flag user redeclarations. */
export function preludeNames(): ReadonlySet<string> {
  if (cachedNames !== undefined) return cachedNames;
  cachedNames = new Set(preludeDocument().nodes.map((n) => n.id));
  return cachedNames;
}
```

(Confirm `Severity.Error === "error"`; if `emit/json.ts` doesn't re-export `TodlDocument`, import the type from its declared module and keep the value import of `toJSON`.)

- [ ] **Step 5: Run the test to confirm it passes** — `npm test` (the two prelude tests green).

- [ ] **Step 6: Package the .todl into dist.** In `package.json`, change `build` so the source `.todl` is copied beside the compiled module:

```json
"build": "tsc -p tsconfig.build.json && node -e \"require('fs').mkdirSync('dist/stdlib',{recursive:true});require('fs').copyFileSync('src/stdlib/prelude.todl','dist/stdlib/prelude.todl')\""
```

Verify: `npm run build` then confirm `dist/stdlib/prelude.todl` exists. (`files` already ships `dist`.)

- [ ] **Step 7: Commit** — `git add src/stdlib package.json && git commit -m "feat(stdlib): prelude.todl + memoized preludeDocument loader"`

---

### Task 2: Inject the prelude into check / checkAgainst

**Files:**
- Modify: `src/api.ts`
- Test: `src/tests/prelude-injection.test.ts` (create)
- Modify: existing tests broken by the new baseline nodes (see Step 5)

**Interfaces:**
- Consumes: `preludeDocument()` from Task 1.
- `load` / `loadInto` stay RAW (no prelude) — the prelude compile in Task 1 depends on that.

- [ ] **Step 1: Write the failing test** `src/tests/prelude-injection.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../api.js";
import { DiagnosticCode } from "../diagnostics/diagnostic.js";

test("a standalone source resolves the prelude primitive `identifier` unqualified", () => {
  const { diagnostics } = check([{ uri: "a.todl", text: `namespace a { concept thing { key : identifier; } }` }]);
  assert.ok(!diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined),
    "identifier should resolve via the injected prelude");
});

test("the prelude concept `element` is present in a plain check", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept thing { } }` }]);
  assert.ok(model.has("element"));
});

test("checkAgainst still composes explicit bases with the prelude underneath", () => {
  const { diagnostics } = checkAgainst([], [{ uri: "a.todl", text: `namespace a { annotate-free concept t { n : slug; } }`.replace("annotate-free ", "") }]);
  assert.ok(!diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined));
});
```

- [ ] **Step 2: Run it to confirm it fails** — `identifier`/`slug`/`element` currently unresolved.

- [ ] **Step 3: Implement injection** in `src/api.ts`. Import `preludeDocument`, prepend it as the first base in both entry points:

```ts
import { preludeDocument } from "./stdlib/prelude.js";
// ...
export function check(sources: SourceFile[]): { model: Repository; diagnostics: Diagnostic[] } {
  return checkAgainst([], sources);
}

export function checkAgainst(
  bases: TodlDocument[],
  sources: SourceFile[],
): { model: Repository; diagnostics: Diagnostic[] } {
  const model = new Repository(mergeBases([preludeDocument(), ...bases]));
  const diagnostics = loadInto(model, sources);
  return { model, diagnostics: [...diagnostics, ...validate(model)] };
}
```

(`check` now routes through `checkAgainst`, so the prelude is injected exactly once, first. `load`/`loadInto` remain untouched and prelude-free.)

- [ ] **Step 4: Run the new test to confirm it passes** — `npm test src/tests/prelude-injection.test.ts` (or full run).

- [ ] **Step 5: Fix baseline-node churn.** Run `npm test`. Every failure will be an assertion that now sees the 7 prelude nodes (`identifier, slug, label, icon, toolbox, instance, element`) or a `reference.undefined` that now resolves. Likely files: `src/tests/check.test.ts`, `src/tests/check-against.test.ts`, `src/language-service/tests/analysis.test.ts`, `src/language-service/tests/completion.test.ts`, `src/language-service/tests/symbols.test.ts`. For each: update `allNodes()`/count assertions to account for prelude nodes (prefer filtering to the source namespace, e.g. `nodes.filter(n => n.attrs.get("namespace") !== "todl")`, over hardcoding new counts), and delete now-stale "reference.undefined" expectations for names the prelude now provides. Do NOT weaken a test to pass — if a test asserted a *diagnostic that is now correctly absent*, removing that expectation is right; if it asserted domain behavior, keep it.

- [ ] **Step 6: Run the full suite to confirm green** — `npm test` → 0 failures.

- [ ] **Step 7: Commit** — `git commit -am "feat(api): inject the prelude as the implicit first base in check/checkAgainst"`

---

### Task 3: Implicit `element` supertype for parent-less concepts

**Files:**
- Modify: `src/parse/loader.ts`
- Test: `src/parse/tests/implicit-element.test.ts` (create)

**Interfaces:**
- Consumes: the prelude `element` node (present as a base whenever `check`/`checkAgainst` ran; absent under raw `load`).
- Rule: a `Concept` declaration whose `extends` is `null` extends `element` — UNLESS it is `element` itself or `element` is not resolvable (raw `load` with no prelude base), so raw prelude compilation and prelude-free `load` callers are unaffected.

- [ ] **Step 1: Write the failing test** `src/parse/tests/implicit-element.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";

test("a parent-less concept implicitly extends element", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept thing { } }` }]);
  assert.ok(model.supertypesOf("thing").includes("element"), "thing should reach element");
});

test("an explicit parent still reaches element transitively", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept base { } concept sub : base { } }` }]);
  const sup = model.supertypesOf("sub");
  assert.ok(sup.includes("base"), "sub extends base");
  assert.ok(sup.includes("element"), "sub reaches element through base");
});

test("element does not extend itself", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept thing { } }` }]);
  assert.ok(!model.supertypesOf("element").includes("element"));
});
```

- [ ] **Step 2: Run it to confirm it fails** — `thing`/`sub` do not reach `element` yet.

- [ ] **Step 3: Implement** in `src/parse/loader.ts`. In Pass 1, replace the concept case:

```ts
      case DeclKind.Concept: {
        // A parent-less concept implicitly extends the prelude root `element`
        // (when it is in scope). `element` itself, and raw `load` with no
        // prelude base, keep their declared (null) parent.
        const parent = declaration.extends
          ?? (declaration.name !== "element" && model.has("element") ? "element" : null);
        first.defineConcept(declaration.name, parent);
        break;
      }
```

(`model.has("element")` is true exactly when the prelude was injected as a base — so raw prelude compilation and any prelude-free `load` are untouched. The synthetic `element` parent is a base node, so it never produces a `reference.undefined`; no change to `collectNames` is needed.)

- [ ] **Step 4: Run the test to confirm it passes** — `npm test src/parse/tests/implicit-element.test.ts`.

- [ ] **Step 5: Run the full suite** — `npm test`. Fix any concept-schema assertions that now inherit `element`'s optional `label`/`description` (effectiveSchema now includes them for parent-less concepts). Optional members add no required-field diagnostics, so failures here are node/field-list assertions to update, not behavior regressions.

- [ ] **Step 6: Commit** — `git commit -am "feat(loader): parent-less concepts implicitly extend the prelude root element"`

---

### Task 4: `PreludeNameRedeclared` diagnostic

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (enum member)
- Modify: `src/parse/loader.ts` (`loadInto` gains a reserved-names param; emit on redeclaration)
- Modify: `src/api.ts` (pass `preludeNames()` through)
- Test: `src/parse/tests/prelude-redeclare.test.ts` (create)

**Interfaces:**
- Consumes: `preludeNames()` from Task 1.
- `loadInto(model, sources, reserved?: ReadonlySet<string>)` — new optional trailing param; defaults to empty so raw `load` and existing callers are unchanged.

- [ ] **Step 1: Add the enum member** in `src/diagnostics/diagnostic.ts`, in the semantic group:

```ts
  // Prelude (default library) phase.
  PreludeNameRedeclared = "prelude.name-redeclared",
```

- [ ] **Step 2: Write the failing test** `src/parse/tests/prelude-redeclare.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode, Severity } from "../../diagnostics/diagnostic.js";

test("redeclaring a prelude primitive warns but still compiles", () => {
  const { diagnostics } = check([{ uri: "a.todl", text: `namespace a { primitive identifier : string { } }` }]);
  const d = diagnostics.find((x) => x.code === DiagnosticCode.PreludeNameRedeclared);
  assert.ok(d, "expected a prelude.name-redeclared diagnostic");
  assert.equal(d!.severity, Severity.Warning);
});

test("redeclaring the root concept `element` warns", () => {
  const { diagnostics } = check([{ uri: "a.todl", text: `namespace a { concept element { } }` }]);
  assert.ok(diagnostics.some((x) => x.code === DiagnosticCode.PreludeNameRedeclared));
});

test("a normal concept name does not warn", () => {
  const { diagnostics } = check([{ uri: "a.todl", text: `namespace a { concept widget { } }` }]);
  assert.ok(!diagnostics.some((x) => x.code === DiagnosticCode.PreludeNameRedeclared));
});
```

- [ ] **Step 3: Run it to confirm it fails** — the code member exists but nothing emits it.

- [ ] **Step 4: Implement.** In `src/parse/loader.ts`, thread the reserved set:

```ts
export function loadInto(model: Repository, sources: SourceFile[], reserved: ReadonlySet<string> = new Set()): Diagnostic[] {
```

After `const declarations = units.map((u) => u.decl);`, add a scan that flags redeclarations (names come from Primitive/Concept/Annotation/Taxonomy declarations, which carry a `.name` and `.span`):

```ts
  if (reserved.size > 0) {
    for (const { decl } of units) {
      const named =
        decl.kind === DeclKind.Primitive || decl.kind === DeclKind.Concept ||
        decl.kind === DeclKind.Annotation || decl.kind === DeclKind.Taxonomy;
      if (named && reserved.has(decl.name)) {
        diagnostics.push({
          code: DiagnosticCode.PreludeNameRedeclared,
          severity: Severity.Warning,
          message: `"${decl.name}" is provided by the default library; remove the local declaration`,
          span: decl.span,
          node: decl.name,
          path: null,
        });
      }
    }
  }
```

In `src/api.ts`, pass the set through: `const diagnostics = loadInto(model, sources, preludeNames());`

- [ ] **Step 5: Run the new test to confirm it passes** — `npm test src/parse/tests/prelude-redeclare.test.ts`.

- [ ] **Step 6: Run the full suite** — `npm test`. Any fixture that declared its own `identifier`/`label`/`slug`/`icon`/`toolbox` now emits this warning; update those tests' diagnostic expectations (or drop the now-redundant local declaration from the fixture). Warnings do not fail compilation.

- [ ] **Step 7: Commit** — `git commit -am "feat(loader): warn when a source redeclares a prelude name"`

---

## Self-Review

- **Spec coverage:** residence + build (T1), first-base injection + unqualified resolution via seeding (T2), implicit `element` root with optional members (T3), reserved-name diagnostic (T4), bootstrapping via raw `load` (T1 note + T3 guard). All spec sections map to a task.
- **Type consistency:** `preludeDocument()`/`preludeNames()` (T1) consumed by T2/T4; `loadInto`'s new trailing `reserved` param defaults empty so `load` and other callers are unaffected; `DiagnosticCode.PreludeNameRedeclared` added once (T4 Step 1) before use.
- **Open sub-points (from the spec, not blocking):** whether `instance` belongs in the language prelude vs. Plexus convention; final severity/name of the diagnostic; `element` member types — all resolved in-plan by the concrete choices above and revisable without restructuring.
- **Refinement vs. spec:** the spec said "compiled to `dist/stdlib/prelude.json` at build"; this plan ships `prelude.todl` and compiles it once at load (memoized), which keeps a single hand-editable artifact and works identically under `tsx` (dev) and packaged (prod). Same authoring workflow (edit `prelude.todl`, rebuild/republish). Flag on review if a prebuilt `.json` is preferred instead.
