# Annotation Inheritance (OOP `:`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Give TODL annotations single inheritance (`annotation Sub : Base { … }`): inherited params (free via `effectiveFields`), two new validation checks, and polymorphic `projectAnnotations`. Plexus consumers gain polymorphism on a version bump with no logic change.

**Architecture:** `:` after an annotation name stages an `Extends` edge (sub → base), reusing the concept mechanism. Annotation params are already `HasField` edges, so `effectiveFields`/`effectiveSchema` inherit them and the existing app-param validator (already reads `effectiveSchema`) enforces inherited required params with no change.

**Tech Stack:** TypeScript ESM; TODL node:test; Verdaccio.

**Spec:** `docs/superpowers/specs/2026-08-06-annotation-inheritance-design.md`.

## Global Constraints

- Verdaccio `http://localhost:4873/`. TODL `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- Tests in `tests/` subfolders. Real enums. Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (commit authorized this run).
- TODL: test `npx tsx --conditions=development --test "src/**/*.test.ts"`; typecheck `npm run typecheck`; build `npm run build`. Plexus: `npx vitest run`.
- **Regression gate:** existing annotation tests + full suite stay green; a no-`:` annotation behaves exactly as today.

## File Structure

- `src/parse/parser.ts` — `parseAnnotation` reads optional `: <base>`.
- `src/parse/ast.ts` — `AnnotationDecl.extends` + `extendsSpan`.
- `src/model/builder.ts` — `defineAnnotation(id, extendsId?)`.
- `src/parse/loader.ts` — pass 1 passes `declaration.extends`.
- `src/diagnostics/diagnostic.ts` — two new `DiagnosticCode`s.
- `src/validate/validate.ts` — `base-not-annotation` + `param-redeclared` checks.
- `src/publish/reflect.ts` — polymorphic `projectAnnotations`.
- `package.json` — `0.18.0`.

---

### Task 1: grammar + AST — `annotation Sub : Base { … }`

**Files:** `src/parse/ast.ts`, `src/parse/parser.ts`; Test: `src/parse/tests/parse-annotation-extends.test.ts` (or extend an existing parser test).

- [ ] **Step 1: Failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";

function annDecl(src: string) {
  const unit = parse({ uri: "t.todl", text: src });
  const ns = unit.ast!.namespaces[0]!;
  return ns.decls.find((d) => d.kind === DeclKind.Annotation) as any;
}

test("annotation with a base parses its extends", () => {
  const d = annDecl(`namespace n { annotation visual { icon : string; } annotation detailed : visual { badge : string; } }`);
  // the second annotation
  const decls = parse({ uri: "t.todl", text: `namespace n { annotation detailed : visual { badge : string; } }` }).ast!.namespaces[0]!.decls;
  const detailed = decls.find((x: any) => x.name === "detailed") as any;
  assert.equal(detailed.extends, "visual");
});

test("annotation without a base has null extends", () => {
  const decls = parse({ uri: "t.todl", text: `namespace n { annotation icon { path : string; } }` }).ast!.namespaces[0]!.decls;
  assert.equal((decls[0] as any).extends, null);
});
```

(Adjust the AST navigation to the real `parse` return shape — inspect `ParseResult`/`load` if `parse` differs.)

- [ ] **Step 2: Run — FAIL** (`extends` undefined on `AnnotationDecl`).

- [ ] **Step 3: Implement**

`ast.ts` — add to `AnnotationDecl`:
```ts
extends: string | null;
extendsSpan?: SourceSpan;
```

`parser.ts` `parseAnnotation` — after `const nameTok = this.expect(TokenKind.Identifier);` add optional base (copy from `parseConcept`):
```ts
let extendsName: string | null = null;
let extendsSpan: SourceSpan | undefined;
if (this.match(TokenKind.Colon)) {
  const startTok = this.current();
  extendsName = this.parseDottedPath();
  extendsSpan = this.spanFrom(startTok);
}
```
and set on the decl: `const decl: AnnotationDecl = { kind: DeclKind.Annotation, name: nameTok.value, extends: extendsName, params, span: this.spanFrom(start) };` plus `if (extendsSpan !== undefined) decl.extendsSpan = extendsSpan;`.

- [ ] **Step 4: Run — PASS** + full suite green.
- [ ] **Step 5: Commit** — `feat(parse): annotation single-inheritance base (annotation Sub : Base)`.

---

### Task 2: loader + builder — stage the `Extends` edge; inherit params

**Files:** `src/model/builder.ts`, `src/parse/loader.ts`; Test: `src/parse/tests/annotation-inheritance.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { Severity } from "../../diagnostics/diagnostic.js";

const SRC = `namespace n {
  annotation visual { icon : string; }
  annotation detailed : visual { badge : string; }
  concept thing {}
  annotate-target: {}
}`;

test("a sub-annotation inherits its base params via effectiveFields", () => {
  const { model, diagnostics } = check([{ uri: "n.todl", text:
    `namespace n { annotation visual { icon : string; } annotation detailed : visual { badge : string; } }` }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  const names = model.effectiveSchema("detailed").fields.map((f) => f.name).sort();
  assert.deepEqual(names, ["badge", "icon"]);
});

test("applying a sub-annotation requires an inherited required param", () => {
  // `detailed` inherits required `icon`; omitting it must error (proves app
  // validation flows through inheritance — no validator change needed).
  const src = `namespace n {
    annotation visual { icon : string; }
    annotation detailed : visual { badge : string; }
    concept thing { annotate detailed { badge = "b"; } }
  }`;
  const errs = check([{ uri: "n.todl", text: src }]).diagnostics.filter((d) => d.severity === Severity.Error);
  assert.ok(errs.some((d) => d.message.includes('requires parameter "icon"')));
});
```

- [ ] **Step 2: Run — FAIL** (no `Extends` edge → `effectiveSchema("detailed")` lacks `icon`).

- [ ] **Step 3: Implement**

`builder.ts` — mirror `defineConcept`:
```ts
defineAnnotation(id: NodeId, extendsId: NodeId | null = null): this {
  this.stageNode(id, Tier.Ontology, MetaKind.Annotation);
  if (extendsId !== null) {
    this.stagedEdges.push({ kind: EdgeKind.Extends, via: null, from: id, to: extendsId });
  }
  return this;
}
```

`loader.ts` pass 1 — `case DeclKind.Annotation:` change to:
```ts
case DeclKind.Annotation:
  first.defineAnnotation(declaration.name, declaration.extends ?? null);
  break;
```

- [ ] **Step 4: Run — PASS** + full suite green (existing no-base annotations unaffected — `extends ?? null` → `null`).
- [ ] **Step 5: Commit** — `feat(model): annotation Extends edge + inherited params`.

---

### Task 3: validation — `base-not-annotation` + `param-redeclared`

**Files:** `src/diagnostics/diagnostic.ts`, `src/validate/validate.ts`; extend the Task 2 test file.

- [ ] **Step 1: Failing tests**

```ts
test("annotation extending a non-annotation errors", () => {
  const src = `namespace n { concept c {} annotation bad : c { p : string; } }`;
  const errs = check([{ uri: "n.todl", text: src }]).diagnostics.filter((d) => d.severity === Severity.Error);
  assert.ok(errs.some((d) => d.code === "annotation.base-not-annotation"));
});

test("redeclaring an inherited param errors", () => {
  const src = `namespace n {
    annotation visual { icon : string; }
    annotation detailed : visual { icon : string; badge : string; }
  }`;
  const errs = check([{ uri: "n.todl", text: src }]).diagnostics.filter((d) => d.severity === Severity.Error);
  assert.ok(errs.some((d) => d.code === "annotation.param-redeclared"));
});

test("a no-base annotation raises neither new error", () => {
  const errs = check([{ uri: "n.todl", text: `namespace n { annotation icon { path : string; } }` }])
    .diagnostics.filter((d) => d.severity === Severity.Error);
  assert.deepEqual(errs, []);
});
```

- [ ] **Step 2: Run — FAIL** (codes not emitted).

- [ ] **Step 3: Implement**

`diagnostic.ts` — add under the Annotation phase:
```ts
AnnotationBaseNotAnnotation = "annotation.base-not-annotation",
AnnotationParamRedeclared = "annotation.param-redeclared",
```

`validate.ts` — add a check over each annotation node (typeOf `MetaKind.Annotation`). Find the existing annotation-validation pass (near `validateAnnotationApplication`) and add a declaration-level check that iterates annotation nodes:
```ts
// For each annotation node with an Extends base:
//  - base node typeOf must be MetaKind.Annotation → else AnnotationBaseNotAnnotation
//  - own param names ∩ inherited param names (supertypesOf) → AnnotationParamRedeclared
for (const ann of model.allNodes().filter((n) => n.typeOf === MetaKind.Annotation)) {
  const supers = model.supertypesOf(ann.id);
  for (const base of model.related(ann.id, EdgeKind.Extends, Direction.Out)) {
    const baseNode = model.resolve(base);
    if (baseNode !== undefined && baseNode.typeOf !== MetaKind.Annotation)
      out.push({ code: DiagnosticCode.AnnotationBaseNotAnnotation, severity: Severity.Error,
        message: `annotation "${ann.id}" may only extend an annotation, not "${base}"`,
        span: model.spanOf(ann.id), node: ann.id, path: null });
  }
  const own = new Set(model.schemaOf(ann.id).fields.map((f) => f.name));
  const inherited = new Set(supers.flatMap((s) => model.schemaOf(s).fields.map((f) => f.name)));
  for (const name of own) if (inherited.has(name))
    out.push({ code: DiagnosticCode.AnnotationParamRedeclared, severity: Severity.Error,
      message: `annotation "${ann.id}" redeclares inherited parameter "${name}"`,
      span: model.spanOf(ann.id), node: ann.id, path: null });
}
```
(Confirm `schemaOf` gives *own* fields and `effectiveSchema` gives inherited; adjust names to the real `Repository` API. `related`/`Direction`/`EdgeKind` are already used in `validate.ts`/`model.ts`.)

- [ ] **Step 4: Run — PASS** + full suite green.
- [ ] **Step 5: Commit** — `feat(validate): annotation base-not-annotation + param-redeclared`.

---

### Task 4: polymorphic `projectAnnotations`

**Files:** `src/publish/reflect.ts`; extend `src/publish/tests/reflect.test.ts`.

- [ ] **Step 1: Failing test**

```ts
test("projectAnnotations indexes an application under its annotation's ancestors (polymorphism)", () => {
  // detailed : visual ; X carries @detailed → queryable as detailed AND visual.
  const doc: TodlDocument = {
    nodes: [
      { id: "visual", tier: "Ontology", typeOf: "Annotation", attrs: {} },
      { id: "detailed", tier: "Ontology", typeOf: "Annotation", attrs: {} },
      { id: "X", tier: "Ontology", typeOf: "concept", attrs: {} },
      { id: "X@detailed", tier: "Ontology", typeOf: "detailed", attrs: { icon: "a.svg", badge: "new", namespace: "n" } },
    ],
    edges: [
      { kind: "Extends", via: null, from: "detailed", to: "visual" },
      { kind: "Annotated", via: null, from: "X", to: "X@detailed" },
    ],
  };
  const got = projectAnnotations(doc, "X");
  assert.deepEqual(got.detailed, { icon: "a.svg", badge: "new" });
  assert.deepEqual(got.visual, { icon: "a.svg", badge: "new" }); // is-a base
});
```

- [ ] **Step 2: Run — FAIL** (only `detailed` keyed).

- [ ] **Step 3: Implement** — make `projectAnnotations` walk the annotation `Extends` chain:

```ts
import { MetaKind } from "../model/kinds.js";
const EXTENDS = "Extends";

export function projectAnnotations(model: TodlDocument, targetId: string): Record<string, Record<string, unknown>> {
  const annIds = new Set(model.nodes.filter((n) => n.typeOf === MetaKind.Annotation).map((n) => n.id));
  const parent = new Map<string, string>();
  for (const e of model.edges) if (e.kind === EXTENDS && annIds.has(String(e.from))) parent.set(String(e.from), String(e.to));
  const chain = (name: string): string[] => {
    const out = [name]; const seen = new Set([name]); let cur = parent.get(name);
    while (cur !== undefined && !seen.has(cur)) { out.push(cur); seen.add(cur); cur = parent.get(cur); }
    return out;
  };
  const out: Record<string, Record<string, unknown>> = {};
  for (const edge of model.edges) {
    if (edge.kind !== ANNOTATED || edge.from !== targetId) continue;
    const appNode = model.nodes.find((n) => n.id === edge.to);
    if (appNode === undefined) continue;
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(appNode.attrs as Record<string, unknown>)) {
      if (k === NAMESPACE_ATTR) continue;
      params[k] = v;
    }
    for (const name of chain(appNode.typeOf)) out[name] = params;
  }
  return out;
}
```

- [ ] **Step 4: Run — PASS**; existing `reflect.test.ts` (direct, no-extends) stays green (no annotation Extends edges → `chain` returns `[name]` → identical behavior).
- [ ] **Step 5: Commit** — `feat(publish): polymorphic projectAnnotations (is-a up the annotation extends chain)`.

---

### Task 5: full suite + bump `0.18.0` + publish

- [ ] **Step 1:** `npx tsx --conditions=development --test "src/**/*.test.ts"` + `npm run typecheck` + `npm run build` → all green.
- [ ] **Step 2:** `npm version minor --no-git-tag-version` (0.17.0 → 0.18.0).
- [ ] **Step 3:** `npm publish`; verify `npm view @pragmatic-lab/todl version --registry http://localhost:4873` → `0.18.0`.
- [ ] **Step 4: Commit** (package.json + package-lock) — `chore: release 0.18.0 (annotation inheritance)`.

---

### Task 6: Plexus — bump to `^0.18.0` + verify

**Files:** `Plexus/package.json`.

- [ ] **Step 1:** `npm install @pragmatic-lab/todl@^0.18.0 --registry http://localhost:4873`; verify installed `0.18.0`.
- [ ] **Step 2:** `npm run compile:mu` + `npx vitest run` + `npm run typecheck` → all green (consumers unchanged; polymorphism is transparent).
- [ ] **Step 3: Commit** — `chore: bump @pragmatic-lab/todl to ^0.18.0 (annotation inheritance)`.

## Notes for the executor

- TODL tasks 1–5 first; publish `0.18.0` before Plexus task 6.
- **Verify the `Repository` API names before Task 3** — `schemaOf` (own fields) vs `effectiveSchema` (inherited); `related(id, EdgeKind.Extends, Direction.Out)` for the direct base. Adjust the validation code to the real signatures; the tests assert behavior.
- **No cycle check** — intentional (concepts don't have one; `closure`/`chain` are cycle-safe).
- Keep the parser test's AST navigation aligned with the real `parse`/`load` return shape.
