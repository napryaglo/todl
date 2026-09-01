# TODL `model … conforms <viewpoint>` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an optional `conforms <viewpoint>` clause to `model` declarations that validates every contained concrete entity's concept is framed by the viewpoint (subtype-aware).

**Architecture:** Mirror the model `uses`/`libraries` binding: parse the clause onto `ModelDecl`, resolve it to a viewpoint in the loader (rewrite qualified → flat), store it as the model node's `conforms` attr, and check framing in `validateModel`.

**Tech Stack:** TypeScript (ESM, strict), `@pragmatic-tech-ai/todl`. Tests via `tsx`.

## Global Constraints

- Run the full suite: `tsx --conditions=development --test "src/**/*.test.ts"`; single file: `tsx --conditions=development --test <path>`; typecheck: `npm run typecheck`.
- Real TS enums; extend existing `DiagnosticCode`.
- Every test file in a `tests/` subfolder next to source.
- Emit/round-trip of `conforms` is OUT of scope (deferred to SP2b).

---

### Task 1: Parse `conforms <viewpoint>`

**Files:**
- Modify: `src/parse/ast.ts` (`ModelDecl.conforms` + `conformsSpan`)
- Modify: `src/parse/parser.ts` (`parseModel`)
- Test: `src/parse/tests/model-conforms-parse.test.ts`

**Interfaces:**
- Produces: `ModelDecl.conforms: string | null`, `ModelDecl.conformsSpan?: SourceSpan`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type ModelDecl } from "../ast.js";

function model(src: string): ModelDecl {
  const { namespace } = parse(`namespace n {\n${src}\n}`, "t.todl");
  const decl = namespace.declarations.find((d) => d.kind === DeclKind.Model);
  assert.ok(decl, "expected a model declaration");
  return decl as ModelDecl;
}

test("model parses a conforms clause", () => {
  const m = model(`model M : mm conforms ComponentView {}`);
  assert.equal(m.conforms, "ComponentView");
});

test("conforms follows uses", () => {
  const m = model(`model M : mm uses tech conforms ComponentView {}`);
  assert.deepEqual(m.libraries, ["tech"]);
  assert.equal(m.conforms, "ComponentView");
});

test("a model without conforms has conforms null", () => {
  const m = model(`model M : mm {}`);
  assert.equal(m.conforms, null);
});

test("conforms accepts a qualified viewpoint", () => {
  const m = model(`model M : mm conforms archmm.ComponentView {}`);
  assert.equal(m.conforms, "archmm.ComponentView");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `tsx --conditions=development --test src/parse/tests/model-conforms-parse.test.ts`
Expected: FAIL — `conforms` is undefined on `ModelDecl`.

- [ ] **Step 3: Extend `ModelDecl`**

In `src/parse/ast.ts`, add to the `ModelDecl` interface (after `librarySpans`):

```ts
  /** The viewpoint this model conforms to (`… conforms <viewpoint>`), or null. */
  conforms: string | null;
  /** Span of the `conforms` viewpoint identifier, when present. */
  conformsSpan?: SourceSpan;
```

- [ ] **Step 4: Parse the clause**

In `src/parse/parser.ts` `parseModel`, after the `uses` block (the
`if (this.checkKeyword("uses")) { … }`) and before `const instances: InstanceDecl[] = [];`:

```ts
    let conforms: string | null = null;
    let conformsSpan: SourceSpan | undefined;
    if (this.checkKeyword("conforms")) {
      this.advance();
      const cStart = this.current();
      conforms = this.parseDottedPath();   // viewpoint may be ns-qualified
      conformsSpan = this.spanFrom(cStart);
    }
```

In the `const decl: ModelDecl = { … }` literal, add `conforms,` (after `instances,`). After the existing `if (librarySpans.length > 0) …` line, add:

```ts
    if (conformsSpan !== undefined) decl.conformsSpan = conformsSpan;
```

- [ ] **Step 5: Run to verify it passes**

Run: `tsx --conditions=development --test src/parse/tests/model-conforms-parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Full suite + typecheck**

Run: `tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: all green (existing ModelDecl constructions must set `conforms` — the loader/emit build `ModelDecl` only via the parser, so no other construction sites; if typecheck flags a missing `conforms`, add `conforms: null` there).

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/model-conforms-parse.test.ts
git commit -m "feat(todl): parse model conforms <viewpoint> clause"
```

---

### Task 2: Resolve + store the conforms viewpoint

**Files:**
- Modify: `src/parse/loader.ts` (resolution loop, `applyModel`, `recordSpans`, `isViewpoint`)
- Modify: `src/diagnostics/diagnostic.ts` (`ModelConformsNotViewpoint`)
- Test: `src/parse/tests/model-conforms-load.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ModelDecl.conforms`); SP1 (`MetaKind.Viewpoint`).
- Produces: the model node carries a `conforms` string attr (flat viewpoint id); `DiagnosticCode.ModelConformsNotViewpoint = "model.conforms-not-viewpoint"`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function loadResult(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]);
}

test("conforms is stored on the model node as a flat attr", () => {
  const { model } = loadResult(`concept Component {}
    viewpoint ComponentView : frames Component
    model M : n conforms ComponentView { Component web {} }`);
  assert.equal(model.resolve("M")?.attrs.get("conforms"), "ComponentView");
});

test("a qualified conforms rewrites to the flat viewpoint id", () => {
  const { model, diagnostics } = loadResult(`concept Component {}
    viewpoint ComponentView : frames Component
    model M : n conforms n.ComponentView { Component web {} }`);
  assert.ok(!diagnostics.some((d) => d.code === DiagnosticCode.ModelConformsNotViewpoint));
  assert.equal(model.resolve("M")?.attrs.get("conforms"), "ComponentView");
});

test("conforms to a non-viewpoint is flagged", () => {
  const { diagnostics } = loadResult(`concept Component {}
    model M : n conforms Component { Component web {} }`);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ModelConformsNotViewpoint));
});

test("conforms to an unknown id is flagged", () => {
  const { diagnostics } = loadResult(`concept Component {}
    model M : n conforms Nope { Component web {} }`);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ModelConformsNotViewpoint));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `tsx --conditions=development --test src/parse/tests/model-conforms-load.test.ts`
Expected: FAIL — no `conforms` attr, `ModelConformsNotViewpoint` undefined.

- [ ] **Step 3: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, next to the model binding codes:

```ts
  ModelConformsNotViewpoint = "model.conforms-not-viewpoint",
```

- [ ] **Step 4: Add the `isViewpoint` helper + resolution loop**

In `src/parse/loader.ts`, next to the existing `isTaxonomy` helper (~line 145):

```ts
  const isViewpoint = (id: string): boolean => {
    for (const decl of declarations) if (decl.kind === DeclKind.Viewpoint && decl.name === id) return true;
    return model.resolve(id)?.typeOf === MetaKind.Viewpoint;
  };
```

Immediately AFTER the model `libraries`/`uses` resolution loop (the
`for (const { ns, imports, decl } of units) { if (decl.kind !== DeclKind.Model) continue; decl.libraries.forEach(…) }`), add:

```ts
  // A model's `conforms <viewpoint>` binds the viewpoint it homes entities for.
  // Resolve it (rewrite qualified → flat) and require a viewpoint.
  for (const { ns, imports, decl } of units) {
    if (decl.kind !== DeclKind.Model || decl.conforms === null) continue;
    const home: Home = { ns, imports };
    const r = resolveRef(decl.conforms, home);
    const flat = r.kind === "qualified" ? r.flat : decl.conforms;
    if (r.kind === "qualified") decl.conforms = flat;
    if ((r.kind === "ok" || r.kind === "qualified") && isViewpoint(flat)) continue;
    diagnostics.push({
      code: DiagnosticCode.ModelConformsNotViewpoint,
      severity: Severity.Error,
      message: r.kind === "unreachable"
        ? `model "${decl.id}" conforms to "${decl.conforms}", which is defined in namespace "${r.ns}" but not imported here — add \`import ${r.ns};\``
        : `model "${decl.id}" conforms to "${decl.conforms}", which is not a known viewpoint`,
      span: decl.conformsSpan ?? decl.span,
      node: decl.id,
      path: null,
    });
  }
```

- [ ] **Step 5: Store the attr in `applyModel`**

In `applyModel` (loader.ts ~643), after the `uses.*` field writes and before
`asserted.add(decl.id);`:

```ts
  if (decl.conforms !== null) builder.setField(decl.id, "conforms", decl.conforms);
```

- [ ] **Step 6: Record the span**

In `recordSpans`'s Model case, after the `librarySpans?.forEach(…)` block:

```ts
        if (declaration.conformsSpan !== undefined) {
          model.recordSpan(Repository.memberKey(declaration.id, "conforms"), declaration.conformsSpan);
        }
```

- [ ] **Step 7: Run to verify it passes**

Run: `tsx --conditions=development --test src/parse/tests/model-conforms-load.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Full suite + typecheck**

Run: `tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/parse/loader.ts src/diagnostics/diagnostic.ts src/parse/tests/model-conforms-load.test.ts
git commit -m "feat(todl): resolve + store model conforms viewpoint"
```

---

### Task 3: Validate contained entities are framed

**Files:**
- Modify: `src/validate/validate.ts` (`validateModel`)
- Modify: `src/diagnostics/diagnostic.ts` (`ModelEntityNotFramed`)
- Test: `src/validate/tests/model-conforms-validate.test.ts`

**Interfaces:**
- Consumes: Task 2 (`conforms` attr on the model node); SP1 (`Repository.viewpointsFraming`).
- Produces: `DiagnosticCode.ModelEntityNotFramed = "model.entity-not-framed"`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(text: string): DiagnosticCode[] {
  return check([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).diagnostics.map((d) => d.code);
}

const VP = `concept Component {} concept Node {}
  viewpoint ComponentView : frames Component`;

test("an entity of a framed concept is clean", () => {
  const c = codes(`${VP}
    model M : n conforms ComponentView { Component web {} }`);
  assert.ok(!c.includes(DiagnosticCode.ModelEntityNotFramed));
});

test("an entity of a non-framed concept is flagged", () => {
  const c = codes(`${VP}
    model M : n conforms ComponentView { Node host {} }`);
  assert.ok(c.includes(DiagnosticCode.ModelEntityNotFramed));
});

test("a subtype of a framed concept is clean (subtype-aware)", () => {
  const c = codes(`concept Component {} concept WebComponent : Component {}
    viewpoint ComponentView : frames Component
    model M : n conforms ComponentView { WebComponent web {} }`);
  assert.ok(!c.includes(DiagnosticCode.ModelEntityNotFramed));
});

test("a model without conforms imposes no framing constraint", () => {
  const c = codes(`${VP}
    model M : n { Node host {} }`);
  assert.ok(!c.includes(DiagnosticCode.ModelEntityNotFramed));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `tsx --conditions=development --test src/validate/tests/model-conforms-validate.test.ts`
Expected: FAIL — `ModelEntityNotFramed` undefined / no framing check.

- [ ] **Step 3: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, next to `ModelConformsNotViewpoint`:

```ts
  ModelEntityNotFramed = "model.entity-not-framed",
```

- [ ] **Step 4: Add the framing check to `validateModel`**

In `src/validate/validate.ts`, at the END of `validateModel` (after the
contained-constructor loop), add:

```ts
  // conforms <viewpoint>: every concrete entity the model homes must have a
  // concept framed by the viewpoint (subtype-aware via viewpointsFraming).
  const conforms = node.attrs.get("conforms");
  if (typeof conforms === "string" && model.resolve(conforms)?.typeOf === MetaKind.Viewpoint) {
    for (const objId of model.closure(node.id, EdgeKind.Contains, Direction.Out, false)) {
      const obj = model.resolve(objId);
      if (obj === undefined || obj.attrs.get("class") === true) continue;
      if (!model.viewpointsFraming(obj.typeOf).includes(conforms)) {
        out.push({
          code: DiagnosticCode.ModelEntityNotFramed,
          severity: Severity.Error,
          message: `entity "${objId}" is a ${obj.typeOf}, not framed by viewpoint "${conforms}"`,
          span: model.spanOf(objId) ?? model.spanOf(node.id),
          node: objId,
          path: null,
        });
      }
    }
  }
```

(`EdgeKind`, `Direction`, `MetaKind`, `Severity` are already imported/used in validate.ts.)

- [ ] **Step 5: Run to verify it passes**

Run: `tsx --conditions=development --test src/validate/tests/model-conforms-validate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Full suite + typecheck**

Run: `tsx --conditions=development --test "src/**/*.test.ts"` then `npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/validate/validate.ts src/diagnostics/diagnostic.ts src/validate/tests/model-conforms-validate.test.ts
git commit -m "feat(todl): validate model conforms framing (entity-not-framed)"
```
