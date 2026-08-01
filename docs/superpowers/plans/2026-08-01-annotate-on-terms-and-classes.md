# `annotate` on Taxonomy Terms and Classes — Implementation Plan (SP1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept an `annotate` application inside a taxonomy `term` body and a `class` declaration; reject it on a concrete instance; keep param/duplicate validation working via the existing path.

**Architecture:** The parser reuses its existing `parseAnnotationApplication` for the new `annotate` sites and carries the applications on new `Term.annotations` / `InstanceDecl.annotations` AST fields. The loader's applications pass stages them against the term node (`<taxonomy>.<term>`) or the class node (`<instanceDecl.id>`) via the existing `builder.annotate` / `stageApplications`; a concrete (non-class) instance carrying `annotate` yields a new `annotation.invalid-target` diagnostic. Validation is unchanged — the application node is already Ontology-tier and typed by the annotation, so `validateAnnotationApplication` covers the new targets for free.

**Tech Stack:** TypeScript (ESM, strict), `node:test` + `node:assert/strict`, run with `tsx --conditions=development`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises (`src/parse/tests/`, `src/validate/tests/`).
- Use real enums, never string-literal unions (repo convention).
- Annotations are **type-level**: legal on concepts, taxonomy terms, `class` declarations, and the package; a concrete (non-class) instance carrying `annotate` is `annotation.invalid-target`.
- Term node id is `<taxonomy>.<term.id>` at every nesting depth; a class node id is the `InstanceDecl.id`. The annotation application node is `<target>@<name>`, Ontology-tier, typed by the annotation.
- Run a single test file with: `npx tsx --conditions=development --test <path>`. Run all with `npm test`.

---

### Task 1: Parse `annotate` in term and class bodies

**Files:**
- Modify: `src/parse/ast.ts` — add `annotations` to `Term` and `InstanceDecl`.
- Modify: `src/parse/parser.ts` — accept `annotate` in `parseTerm` and `parseInstanceFrom`; set `annotations` on every `Term` / `InstanceDecl` literal.
- Modify: `src/parse/loader.ts:418-428` — `termToInstanceDecl` literal gains `annotations: []` (keeps the file compiling).
- Test: `src/parse/tests/annotate-targets.test.ts` (new).

**Interfaces:**
- Consumes: existing `Parser.parseAnnotationApplication(start: Token): AnnotationApplication`, `Parser.checkKeyword(word): boolean`, `Parser.startToken(): Token`.
- Produces: `Term.annotations: AnnotationApplication[]` and `InstanceDecl.annotations: AnnotationApplication[]`, both always present (empty when none). Task 2 reads these.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/annotate-targets.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type TaxonomyDecl, type InstanceDecl } from "../ast.js";

function decls(text: string) {
  const { namespace, diagnostics } = parse(text, "t.todl");
  assert.deepEqual(diagnostics, [], "expected no parse diagnostics");
  return namespace.declarations;
}

test("annotate parses inside a taxonomy term body", () => {
  const tax = decls(`namespace t {
    taxonomy actors : represents actor {
      term internal {
        label = "Internal";
        annotate icon { path = "resources/ai_agent.svg"; }
      }
    }
  }`)[0] as TaxonomyDecl;
  const term = tax.terms[0]!;
  assert.equal(term.annotations.length, 1);
  assert.equal(term.annotations[0]!.name, "icon");
  assert.equal(term.annotations[0]!.assignments[0]!.name, "path");
});

test("a term keeps both an annotate and a nested sub-term", () => {
  const tax = decls(`namespace t {
    taxonomy actors : represents actor {
      term external {
        annotate icon { path = "x.svg"; }
        term partner { label = "Partner"; }
      }
    }
  }`)[0] as TaxonomyDecl;
  const term = tax.terms[0]!;
  assert.equal(term.annotations.length, 1);
  assert.equal(term.children.length, 1);
  assert.equal(term.children[0]!.id, "partner");
});

test("annotate parses inside a class body", () => {
  const cls = decls(`namespace t {
    class component web-app {
      annotate icon { path = "resources/web.svg"; }
    }
  }`)[0] as InstanceDecl;
  assert.equal(cls.kind, DeclKind.Instance);
  assert.equal(cls.isClass, true);
  assert.equal(cls.annotations.length, 1);
  assert.equal(cls.annotations[0]!.name, "icon");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/annotate-targets.test.ts`
Expected: FAIL — `term.annotations` is `undefined` (property does not exist yet) / type error.

- [ ] **Step 3: Add the AST fields**

In `src/parse/ast.ts`, add to `interface Term` (after `children: Term[];`):

```ts
  /** `annotate` applications on this term (a term is a class of its concept). */
  annotations: AnnotationApplication[];
```

and to `interface InstanceDecl` (after `children: InstanceDecl[];`):

```ts
  /** `annotate` applications in this record's body. Staged only for classes;
   * on a concrete instance the loader reports `annotation.invalid-target`. */
  annotations: AnnotationApplication[];
```

(`AnnotationApplication` is already declared in this file — no import needed.)

- [ ] **Step 4: Accept `annotate` in `parseTerm`**

In `src/parse/parser.ts`, in `parseTerm` (around lines 524-541), declare the collector and add an `annotate`-first branch, then thread it into the `Term` literal. Replace:

```ts
    const assignments: AssignmentNode[] = [];
    const children: Term[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const child = this.tryParseTerm();
      if (child !== null) {
        children.push(child);
      } else {
```

with:

```ts
    const assignments: AssignmentNode[] = [];
    const children: Term[] = [];
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      if (this.checkKeyword("annotate")) {
        annotations.push(this.parseAnnotationApplication(this.startToken()));
        continue;
      }
      const child = this.tryParseTerm();
      if (child !== null) {
        children.push(child);
      } else {
```

and replace the `Term` literal:

```ts
    const term: Term = { id, concept, assignments, children, span: this.spanFrom(start) };
```

with:

```ts
    const term: Term = { id, concept, assignments, children, annotations, span: this.spanFrom(start) };
```

The `annotate`-first check is required: `annotate icon` is two identifiers, which `tryParseTerm`'s `Identifier Identifier` lookahead would otherwise misread as a concept-led term.

- [ ] **Step 5: Accept `annotate` in `parseInstanceFrom`**

In `parseInstanceFrom` (around lines 207-228), declare the collector and add an `annotate`-first branch, then thread it into the `InstanceDecl` literal. Replace:

```ts
    const assignments: AssignmentNode[] = [];
    const children: InstanceDecl[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const memberStart = this.startToken();
      if (this.checkKeyword("application-connectors")) {
        children.push(this.parseApplicationConnectors(memberStart));
        continue;
      }
```

with:

```ts
    const assignments: AssignmentNode[] = [];
    const children: InstanceDecl[] = [];
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const memberStart = this.startToken();
      if (this.checkKeyword("annotate")) {
        annotations.push(this.parseAnnotationApplication(memberStart));
        continue;
      }
      if (this.checkKeyword("application-connectors")) {
        children.push(this.parseApplicationConnectors(memberStart));
        continue;
      }
```

and replace the `InstanceDecl` literal:

```ts
    const decl: InstanceDecl = { kind: DeclKind.Instance, concept, id, binds, isClass, instanceOf, assignments, children, span: this.spanFrom(start) };
```

with:

```ts
    const decl: InstanceDecl = { kind: DeclKind.Instance, concept, id, binds, isClass, instanceOf, assignments, children, annotations, span: this.spanFrom(start) };
```

- [ ] **Step 6: Fix the remaining `InstanceDecl` literals**

Add `annotations: []` to the two edge/connector literals so the file typechecks.

In `parseEdgeRecord` (line ~370), replace:

```ts
    return { kind: DeclKind.Instance, concept, id, binds: null, isClass: false, instanceOf: null, assignments, children: [], span: this.spanFrom(start) };
```

with:

```ts
    return { kind: DeclKind.Instance, concept, id, binds: null, isClass: false, instanceOf: null, assignments, children: [], annotations: [], span: this.spanFrom(start) };
```

In `parseApplicationConnectors` (line ~384), replace:

```ts
    return { kind: DeclKind.Instance, concept: "application-connectors", id, binds: null, isClass: false, instanceOf: null, assignments: [], children, span: this.spanFrom(start) };
```

with:

```ts
    return { kind: DeclKind.Instance, concept: "application-connectors", id, binds: null, isClass: false, instanceOf: null, assignments: [], children, annotations: [], span: this.spanFrom(start) };
```

- [ ] **Step 7: Fix the loader's `termToInstanceDecl` literal**

In `src/parse/loader.ts` (lines 418-428), add `annotations: []` to the returned `InstanceDecl` literal (composition-record annotations are staged via the taxonomy walk in Task 2, not this path). Replace:

```ts
    assignments: t.assignments,
    children: t.children.map((c) => termToInstanceDecl(taxonomy, c)),
    span: t.span,
  };
```

with:

```ts
    assignments: t.assignments,
    children: t.children.map((c) => termToInstanceDecl(taxonomy, c)),
    annotations: [],
    span: t.span,
  };
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test src/parse/tests/annotate-targets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Run the full suite to check for regressions**

Run: `npm test`
Expected: all tests pass (the new AST field is optional-free but every literal now sets it).

- [ ] **Step 10: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/loader.ts src/parse/tests/annotate-targets.test.ts
git commit -m "feat(parse): accept annotate inside term and class bodies"
```

---

### Task 2: Stage term/class annotations; reject on concrete instances

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` — add `AnnotationInvalidTarget`.
- Modify: `src/parse/loader.ts` — extend the applications pass (around lines 236-245) to terms, classes, and models; add the `stageInstanceAnnotations` helper.
- Test: `src/parse/tests/loader-annotate-targets.test.ts` (new), `src/validate/tests/validate-annotation-targets.test.ts` (new).

**Interfaces:**
- Consumes: `Term.annotations`, `InstanceDecl.annotations` (Task 1); existing `stageApplications(builder, model, target, apps, seen, diagnostics)`; `builder.annotate`, `EdgeKind.Annotated`.
- Produces: `Annotated` edges from `<taxonomy>.<term.id>` and from `<classDecl.id>`; the `DiagnosticCode.AnnotationInvalidTarget` diagnostic on concrete instances.

- [ ] **Step 1: Write the failing loader test**

Create `src/parse/tests/loader-annotate-targets.test.ts` (a new file — keep imports at the top, per ESM):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { EdgeKind, Direction, Tier } from "../../model/graph.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const TERM_SRC = `namespace tech {
  concept actor { label : string; }
  annotation icon { path : string; }
  taxonomy actors : represents actor {
    term internal {
      label = "Internal";
      annotate icon { path = "resources/ai_agent.svg"; }
    }
  }
}`;

test("a term annotation stages an Annotated edge and an app node", () => {
  const { model } = load([{ uri: "a.todl", text: TERM_SRC }]);
  assert.deepEqual(
    model.related("actors.internal", EdgeKind.Annotated, Direction.Out),
    ["actors.internal@icon"],
  );
  const app = model.resolve("actors.internal@icon");
  assert.equal(app!.tier, Tier.Ontology);
  assert.equal(app!.typeOf, "icon");
  assert.equal(app!.attrs.get("path"), "resources/ai_agent.svg");
});

test("a class annotation stages an Annotated edge from the class node", () => {
  const { model } = load([{ uri: "a.todl", text: `namespace tech {
    concept component { label : string; }
    annotation icon { path : string; }
    class component web-app { annotate icon { path = "resources/web.svg"; } }
  }` }]);
  assert.deepEqual(
    model.related("web-app", EdgeKind.Annotated, Direction.Out),
    ["web-app@icon"],
  );
});

test("annotate on a concrete instance is annotation.invalid-target", () => {
  const { diagnostics } = load([{ uri: "a.todl", text: `namespace tech {
    concept component { label : string; }
    annotation icon { path : string; }
    model m : tech {
      component storefront { label = "S"; annotate icon { path = "w.svg"; } }
    }
  }` }]);
  assert.ok(diagnostics.map((d) => d.code).includes(DiagnosticCode.AnnotationInvalidTarget));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/parse/tests/loader-annotate-targets.test.ts`
Expected: FAIL — no `Annotated` edge from `actors.internal` (empty array), and `DiagnosticCode.AnnotationInvalidTarget` does not exist yet.

- [ ] **Step 3: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, in the `// Annotation phase.` block of `DiagnosticCode`, add:

```ts
  AnnotationInvalidTarget = "annotation.invalid-target",
```

- [ ] **Step 4: Add the `stageInstanceAnnotations` helper**

In `src/parse/loader.ts`, add this function next to `stageApplications` (after it, ~line 513):

```ts
/** Stage annotations on a class instance; reject them on a concrete instance
 * (`annotation.invalid-target`). Recurses into nested records. */
function stageInstanceAnnotations(
  builder: Builder,
  model: Repository,
  decl: InstanceDecl,
  seen: Set<string>,
  diagnostics: Diagnostic[],
): void {
  if (decl.annotations.length > 0) {
    if (decl.isClass) {
      stageApplications(builder, model, decl.id, decl.annotations, seen, diagnostics);
    } else {
      for (const app of decl.annotations) {
        diagnostics.push({
          code: DiagnosticCode.AnnotationInvalidTarget,
          severity: Severity.Error,
          message: `annotation "${app.name}" cannot be applied to concrete instance "${decl.id}" — annotations are type-level (allowed on concepts, taxonomy terms, classes, and the package)`,
          span: app.nameSpan ?? app.span,
          node: decl.id,
          path: null,
        });
      }
    }
  }
  for (const child of decl.children) stageInstanceAnnotations(builder, model, child, seen, diagnostics);
}
```

(`Severity` and `Diagnostic` are already imported in this file; `Builder`, `Repository`, `InstanceDecl`, `Term` are too.)

- [ ] **Step 5: Extend the applications pass**

In `src/parse/loader.ts`, in the applications pass loop (around lines 236-245), add branches for `Taxonomy`, `Instance`, and `Model` after the existing `Concept` / `Package` branches. Replace:

```ts
    if (decl.kind === DeclKind.Concept) {
      fourth.setNamespace(ns);
      stageApplications(fourth, model, decl.name, decl.annotations, seenApps, diagnostics);
    } else if (decl.kind === DeclKind.Package) {
      fourth.setNamespace(ns);
      if (!packageStaged) { fourth.definePackageNode(PACKAGE_NODE_ID); packageStaged = true; }
      stageApplications(fourth, model, PACKAGE_NODE_ID, decl.annotations, seenApps, diagnostics);
    }
```

with:

```ts
    if (decl.kind === DeclKind.Concept) {
      fourth.setNamespace(ns);
      stageApplications(fourth, model, decl.name, decl.annotations, seenApps, diagnostics);
    } else if (decl.kind === DeclKind.Package) {
      fourth.setNamespace(ns);
      if (!packageStaged) { fourth.definePackageNode(PACKAGE_NODE_ID); packageStaged = true; }
      stageApplications(fourth, model, PACKAGE_NODE_ID, decl.annotations, seenApps, diagnostics);
    } else if (decl.kind === DeclKind.Taxonomy) {
      fourth.setNamespace(ns);
      const walkTerm = (t: Term): void => {
        if (t.annotations.length > 0) {
          stageApplications(fourth, model, `${decl.name}.${t.id}`, t.annotations, seenApps, diagnostics);
        }
        t.children.forEach(walkTerm);
      };
      decl.terms.forEach(walkTerm);
    } else if (decl.kind === DeclKind.Instance) {
      fourth.setNamespace(ns);
      stageInstanceAnnotations(fourth, model, decl, seenApps, diagnostics);
    } else if (decl.kind === DeclKind.Model) {
      fourth.setNamespace(ns);
      for (const inst of decl.instances) stageInstanceAnnotations(fourth, model, inst, seenApps, diagnostics);
    }
```

Every term node id is `<taxonomy>.<term.id>` at all depths, so the flat `walkTerm` recursion stages against the correct node whether the term is top-level or nested.

- [ ] **Step 6: Run the loader test to verify it passes**

Run: `npx tsx --conditions=development --test src/parse/tests/loader-annotate-targets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Write the validation-coverage test**

The validator is unchanged; this test proves the existing param checks reach the new targets. Create `src/validate/tests/validate-annotation-targets.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const BASE = `namespace tech {
  concept actor { label : string; }
  annotation icon { path : string; }
  taxonomy actors : represents actor { `;

function codes(termBody: string): DiagnosticCode[] {
  const src = `${BASE} term internal { label = "I"; ${termBody} } } }`;
  return check([{ uri: "a.todl", text: src }]).diagnostics.map((d) => d.code);
}

test("the motivating fixture compiles clean", () => {
  const src = `namespace tech {
    concept actor { label : string; }
    annotation icon { path : string; }
    taxonomy actors : represents actor {
      term internal {
        label = "Internal";
        annotate icon { path = "resources/ai_agent.svg"; }
      }
    }
  }`;
  assert.deepEqual(check([{ uri: "a.todl", text: src }]).diagnostics, []);
});

test("an unknown param on a term annotation is annotation.unknown-param", () => {
  assert.ok(codes(`annotate icon { bogus = "x"; }`).includes(DiagnosticCode.AnnotationUnknownParam));
});

test("a missing required param on a term annotation is cardinality.required-missing", () => {
  assert.ok(codes(`annotate icon { }`).includes(DiagnosticCode.RequiredMissing));
});

test("a duplicate term annotation is annotation.duplicate", () => {
  assert.ok(
    codes(`annotate icon { path = "a"; } annotate icon { path = "b"; }`)
      .includes(DiagnosticCode.AnnotationDuplicate),
  );
});
```

- [ ] **Step 8: Run the validation test**

Run: `npx tsx --conditions=development --test src/validate/tests/validate-annotation-targets.test.ts`
Expected: PASS (4 tests). No production change was needed — this confirms the existing validator covers the new targets.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/parse/loader.ts src/parse/tests/loader-annotate-targets.test.ts src/validate/tests/validate-annotation-targets.test.ts
git commit -m "feat(load): stage term/class annotations; reject annotate on concrete instances"
```

---

### Task 3: Document the new legal locations

**Files:**
- Modify: `docs/todl-language.md` — §4.6 (annotate legal locations), §7 (new diagnostic), §10 (quick reference).

**Interfaces:**
- Consumes: nothing (documentation).
- Produces: nothing (documentation).

- [ ] **Step 1: Update §4.6 legal-locations wording**

In `docs/todl-language.md`, in the `### 4.6 annotation / annotate — typed metadata` section, replace the sentence:

```
Apply it with `annotate` — legal only inside a `concept` body or a `package { }`
block — giving each param a fixed value:
```

with:

```
Apply it with `annotate` — legal inside a `concept` body, a taxonomy `term`
body, a `class` declaration, or a `package { }` block (annotations are
type-level; a concrete instance carrying `annotate` is `annotation.invalid-target`)
— giving each param a fixed value:
```

- [ ] **Step 2: Add a term example**

In the same section, after the existing `package { … }` example block, add:

```markdown
A taxonomy term is a class of its concept, so it takes annotations too — this is
how each term gets its own icon:

    taxonomy actors : represents actor
    {
        term internal
        {
            label = "Internal";
            annotate icon { path = "resources/internal.svg"; }
        }
    }
```

- [ ] **Step 3: Document the new diagnostic**

In §7, in the "Instances, references, models, annotations" list, add after the `annotation.unknown-param` bullet:

```markdown
- `annotation.invalid-target` — `annotate` appears on a concrete instance;
  annotations are type-level (concepts, taxonomy terms, classes, package).
```

- [ ] **Step 4: Update the quick reference**

In §10, replace the taxonomy line:

```
    taxonomy some-taxonomy : represents thing { term a { label = "A"; } }
```

with:

```
    taxonomy some-taxonomy : represents thing {
        term a { label = "A"; annotate icon { path = "a.svg"; } }   // terms take annotations
    }
```

- [ ] **Step 5: Commit**

```bash
git add docs/todl-language.md
git commit -m "docs: annotate is legal on terms and classes"
```

---

## Notes for the implementer

- The whole feature rides on two existing facts: a term is already an Instance-tier `class` node (`builder.ts:189-193`), and `builder.annotate` stages an Ontology-tier app node + `Annotated` edge for any target (`builder.ts:88-92`). You are only routing the parser's output to `stageApplications` with the right target id.
- Do not touch `src/validate/validate.ts` — the application node is Ontology-tier and typed by the annotation, so `validateAnnotationApplication` already handles the new targets. Task 2 Step 7 proves it.
- Keep `termToInstanceDecl` setting `annotations: []`; composition-record annotations are staged through the taxonomy `walkTerm`, which visits every nested term row (both sub-terms and composition records share the `<taxonomy>.<id>` node id).
