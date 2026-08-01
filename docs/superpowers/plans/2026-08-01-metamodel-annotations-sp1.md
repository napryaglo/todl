# Meta-Model Annotations SP1 (TODL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add typed, author-declared `annotation` / `annotate` / `package` constructs to TODL that statically decorate concepts and the package, compiling into the reflective graph.

**Architecture:** New `DeclKind.Annotation`/`Package` AST nodes parsed by reserved keywords; annotation definitions become Ontology-tier `MetaKind.Annotation` nodes whose params are ordinary `HasField` members; each `annotate` becomes an Ontology-tier application node `<target>@<Ann>` (typed by the annotation, params as scalar attrs) linked to its target by `EdgeKind.Annotated`; a singleton `MetaKind.Package` node hosts package-level applications. Emit is unchanged (everything round-trips as nodes/edges/attrs).

**Tech Stack:** TypeScript (ESM, strict), `tsx --test`, `@pragmatic-lab/todl`.

**Spec:** `docs/superpowers/specs/2026-08-01-metamodel-annotations-sp1-design.md`

## Global Constraints

- Target version: **`@pragmatic-lab/todl` 0.5.0** (reserves new keywords). Bump `package.json` in the final task.
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- Runner: `npm test` = `tsx --conditions=development --test "src/**/*.test.ts"`. Single file: `tsx --conditions=development --test src/parse/tests/<file>.test.ts`.
- Enums, not string-literal unions.
- `annotation`, `annotate`, `package` are reserved keywords.
- Annotation param values are **scalar** for v1 (string/number/boolean/enum). Application param values serialize as scalar `attrs`.
- The package node has the reserved id `package` (`PACKAGE_NODE_ID`).
- Work on branch `metamodel-annotations-sp1` (base `main`).

---

## File Structure

- `src/parse/ast.ts` — `DeclKind.Annotation`/`Package`, `AnnotationDecl`, `AnnotationApplication`, `PackageDecl`, `ConceptDecl.annotations`, `Declaration` union. (Task 1)
- `src/parse/parser.ts` — `parseAnnotation`, `parsePackage`, `parseAnnotationApplication`, concept-body `annotate` branch, dispatch. (Task 1)
- `src/model/kinds.ts` — `MetaKind.Annotation`/`Package`, `PACKAGE_NODE_ID`. (Task 2)
- `src/model/graph.ts` — `EdgeKind.Annotated`. (Task 2)
- `src/model/builder.ts` — `defineAnnotation`, `definePackageNode`, `annotate`. (Task 2)
- `src/parse/loader.ts` — defs (pass 1), params (pass 2a), applications pass, `collectNames`/`recordSpans` cases, duplicate detection. (Task 3)
- `src/diagnostics/diagnostic.ts` — `AnnotationDuplicate` (Task 3), `AnnotationUnknownParam` (Task 4).
- `src/validate/validate.ts` — annotation-application validation pass. (Task 4)
- `package.json` — version bump. (Task 6)

---

## Task 1: `annotation` / `annotate` / `package` → AST (parser)

**Files:**
- Modify: `src/parse/ast.ts` (`DeclKind` ~line 12; add three interfaces; `ConceptDecl` ~line 115; `Declaration` union ~line 170)
- Modify: `src/parse/parser.ts` (imports ~line 14; `parseDeclaration` ~line 166; `parseConcept` body loop ~line 503 + its `ConceptDecl` return; add three methods)
- Test: `src/parse/tests/annotation.test.ts` (create)

**Interfaces:**
- Produces: `AnnotationDecl { kind: DeclKind.Annotation; name: string; params: FieldDecl[]; span: SourceSpan; nameSpan?: SourceSpan }`
- Produces: `AnnotationApplication { name: string; assignments: AssignmentNode[]; span: SourceSpan; nameSpan?: SourceSpan }`
- Produces: `PackageDecl { kind: DeclKind.Package; annotations: AnnotationApplication[]; span: SourceSpan }`
- Produces: `ConceptDecl.annotations: AnnotationApplication[]`

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/annotation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type AnnotationDecl, type PackageDecl, type ConceptDecl } from "../ast.js";

function decls(text: string) {
  const { namespace, diagnostics } = parse(text, "t.todl");
  assert.deepEqual(diagnostics, [], "expected no parse diagnostics");
  return namespace.declarations;
}

test("annotation declaration parses to an AnnotationDecl with typed params", () => {
  const d = decls(`namespace a { annotation Category { name : string; order : number?; } }`)[0] as AnnotationDecl;
  assert.equal(d.kind, DeclKind.Annotation);
  assert.equal(d.name, "Category");
  assert.equal(d.params.length, 2);
  assert.equal(d.params[0]!.name, "name");
  assert.equal(d.params[0]!.type, "string");
  assert.ok(d.nameSpan);
});

test("annotate inside a concept attaches an application to the concept", () => {
  const d = decls(`namespace a {
    concept actor {
      annotate Icon { path = "icons/actor.svg"; }
      label : string;
    }
  }`)[0] as ConceptDecl;
  assert.equal(d.kind, DeclKind.Concept);
  assert.equal(d.annotations.length, 1);
  assert.equal(d.annotations[0]!.name, "Icon");
  assert.equal(d.annotations[0]!.assignments[0]!.name, "path");
  assert.ok(d.annotations[0]!.nameSpan);
});

test("package block parses to a PackageDecl of applications", () => {
  const d = decls(`namespace a {
    package {
      annotate Author { name = "Acme"; }
      annotate License { spdx = "MIT"; }
    }
  }`)[0] as PackageDecl;
  assert.equal(d.kind, DeclKind.Package);
  assert.equal(d.annotations.length, 2);
  assert.equal(d.annotations[1]!.name, "License");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/annotation.test.ts`
Expected: FAIL — `DeclKind.Annotation`/`Package` don't exist; `annotation`/`package` parse as generic instances.

- [ ] **Step 3: Extend the AST**

In `src/parse/ast.ts`, add to `DeclKind`:

```ts
export enum DeclKind {
  Primitive,
  Taxonomy,
  Concept,
  Instance,
  Model,
  Annotation,
  Package,
}
```

Add the three interfaces (place after `InstanceDecl`, before `FieldDecl`):

```ts
export interface AnnotationApplication {
  /** The annotation being applied. */
  name: string;
  /** Fixed `param = value` param assignments. */
  assignments: AssignmentNode[];
  span: SourceSpan;
  nameSpan?: SourceSpan;
}

export interface AnnotationDecl {
  kind: DeclKind.Annotation;
  name: string;
  /** Typed params, reusing FieldDecl (name / type / cardinality). */
  params: FieldDecl[];
  span: SourceSpan;
  nameSpan?: SourceSpan;
}

export interface PackageDecl {
  kind: DeclKind.Package;
  annotations: AnnotationApplication[];
  span: SourceSpan;
}
```

Add `annotations` to `ConceptDecl` (after `invariants`):

```ts
  invariants: InvariantDecl[];
  annotations: AnnotationApplication[];
```

Extend the union:

```ts
export type Declaration =
  | ConceptDecl | TaxonomyDecl | PrimitiveDecl | InstanceDecl | ModelDecl
  | AnnotationDecl | PackageDecl;
```

- [ ] **Step 4: Add parser imports + dispatch**

In `src/parse/parser.ts`, add to the ast import group:

```ts
  type AnnotationDecl,
  type AnnotationApplication,
  type PackageDecl,
```

In `parseDeclaration`, add after the `model` branch:

```ts
    if (this.checkKeyword("annotation")) return this.parseAnnotation(start);
    if (this.checkKeyword("package")) return this.parsePackage(start);
```

- [ ] **Step 5: Add the three parse methods**

In `src/parse/parser.ts`, add (place near `parseModel`):

```ts
  /** `annotation <Name> { <param> : <type><card>; … }` — typed param fields. */
  private parseAnnotation(start: Token): AnnotationDecl {
    this.expectKeyword("annotation");
    const nameTok = this.expect(TokenKind.Identifier);
    const params: FieldDecl[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const pNameTok = this.expect(TokenKind.Identifier);
      this.expect(TokenKind.Colon);
      const typeTok = this.expect(TokenKind.Identifier);
      const cardinality = this.parseCardinality();
      this.expect(TokenKind.Semicolon);
      params.push({
        name: pNameTok.value, type: typeTok.value, cardinality,
        nameSpan: tokenSpan(pNameTok, this.uri), typeSpan: tokenSpan(typeTok, this.uri),
      });
    }
    this.expect(TokenKind.RBrace);
    const decl: AnnotationDecl = { kind: DeclKind.Annotation, name: nameTok.value, params, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    return decl;
  }

  /** `annotate <Name> { <param> = <value>; … }` — an application (concept or package body). */
  private parseAnnotationApplication(start: Token): AnnotationApplication {
    this.expectKeyword("annotate");
    const nameTok = this.expect(TokenKind.Identifier);
    const assignments: AssignmentNode[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const aStart = this.startToken();
      const pName = this.expect(TokenKind.Identifier).value;
      this.expect(TokenKind.Equals);
      const value = this.parseValue();
      this.expect(TokenKind.Semicolon);
      assignments.push({ name: pName, value, span: this.spanFrom(aStart) });
    }
    this.expect(TokenKind.RBrace);
    const app: AnnotationApplication = { name: nameTok.value, assignments, span: this.spanFrom(start) };
    app.nameSpan = tokenSpan(nameTok, this.uri);
    return app;
  }

  /** `package { annotate … }` — a block of package-level applications. */
  private parsePackage(start: Token): PackageDecl {
    this.expectKeyword("package");
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      if (!this.checkKeyword("annotate")) throw this.error(`expected "annotate" in a package block`);
      annotations.push(this.parseAnnotationApplication(this.startToken()));
    }
    this.expect(TokenKind.RBrace);
    return { kind: DeclKind.Package, annotations, span: this.spanFrom(start) };
  }
```

- [ ] **Step 6: Wire `annotate` into the concept body + `ConceptDecl` return**

In `parseConcept` (`src/parse/parser.ts`), declare the collection next to `invariants` (~line 500):

```ts
    const annotations: AnnotationApplication[] = [];
```

In the body loop, add a branch before the final `else` (the field branch, ~line 514):

```ts
      } else if (this.checkKeyword("annotate")) {
        annotations.push(this.parseAnnotationApplication(this.startToken()));
      } else {
```

In the `ConceptDecl` object this method returns, add `annotations` to the literal (find the `{ kind: DeclKind.Concept, … }` return and include `annotations,`).

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/annotation.test.ts`
Expected: PASS (all three).

- [ ] **Step 8: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/annotation.test.ts
git commit -m "feat(parse): annotation/annotate/package parse to AST"
```

---

## Task 2: Graph enums + Builder (`defineAnnotation` / `definePackageNode` / `annotate`)

**Files:**
- Modify: `src/model/kinds.ts` (`MetaKind`; add `PACKAGE_NODE_ID`)
- Modify: `src/model/graph.ts` (`EdgeKind`)
- Modify: `src/model/builder.ts` (three methods)
- Test: `src/model/tests/builder-annotation.test.ts` (create)

**Interfaces:**
- Produces: `MetaKind.Annotation = "annotation"`, `MetaKind.Package = "package"`, `PACKAGE_NODE_ID = "package"`.
- Produces: `EdgeKind.Annotated`.
- Produces: `Builder.defineAnnotation(id: NodeId): this`; `Builder.definePackageNode(id: NodeId): this`; `Builder.annotate(target: NodeId, annotationId: NodeId): NodeId` (returns the application id `${target}@${annotationId}`).

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/builder-annotation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, Tier, EdgeKind, Direction } from "../graph.js";
import { MetaKind, PACKAGE_NODE_ID } from "../kinds.js";
import { Builder } from "../builder.js";

test("defineAnnotation stages an Ontology-tier MetaKind.Annotation node", () => {
  const g = new Graph();
  new Builder(g).defineAnnotation("Icon").commit();
  const n = g.getNode("Icon");
  assert.equal(n!.tier, Tier.Ontology);
  assert.equal(n!.typeOf, MetaKind.Annotation);
});

test("annotate stages an application node typed by the annotation + an Annotated edge", () => {
  const g = new Graph();
  const b = new Builder(g);
  b.defineConcept("actor").defineAnnotation("Icon");
  const appId = b.annotate("actor", "Icon");
  b.setField(appId, "path", "a.svg");
  b.commit();
  assert.equal(appId, "actor@Icon");
  const app = g.getNode("actor@Icon");
  assert.equal(app!.tier, Tier.Ontology);
  assert.equal(app!.typeOf, "Icon");
  assert.equal(app!.attrs.get("path"), "a.svg");
  assert.deepEqual(g.related("actor", EdgeKind.Annotated, Direction.Out), ["actor@Icon"]);
});

test("definePackageNode stages the singleton package node", () => {
  const g = new Graph();
  new Builder(g).definePackageNode(PACKAGE_NODE_ID).commit();
  const n = g.getNode(PACKAGE_NODE_ID);
  assert.equal(n!.typeOf, MetaKind.Package);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/model/tests/builder-annotation.test.ts`
Expected: FAIL — enums/methods missing.

- [ ] **Step 3: Add the enums + constant**

In `src/model/kinds.ts`:

```ts
export enum MetaKind {
  Concept = "concept",
  Primitive = "primitive",
  Taxonomy = "taxonomy",
  Field = "field",
  Relationship = "relationship",
  Model = "model",
  Annotation = "annotation",
  Package = "package",
}

/** Reserved id of the singleton package node that hosts package-level annotations. */
export const PACKAGE_NODE_ID = "package";
```

In `src/model/graph.ts`, add to `EdgeKind` (after `Represents`):

```ts
  Annotated, // concept | package -> annotation application node
```

- [ ] **Step 4: Add the Builder methods**

In `src/model/builder.ts`, add (place near `assertModel`):

```ts
  /** Stage an annotation-type declaration node (Ontology-tier). */
  defineAnnotation(id: NodeId): this {
    this.stageNode(id, Tier.Ontology, MetaKind.Annotation);
    return this;
  }

  /** Stage the singleton package node (Ontology-tier), host of package annotations. */
  definePackageNode(id: NodeId): this {
    this.stageNode(id, Tier.Ontology, MetaKind.Package);
    return this;
  }

  /** Stage an annotation application `<target>@<annotationId>` (Ontology-tier, typed by
   *  the annotation) plus the `Annotated` edge target -> application. Returns the app id. */
  annotate(target: NodeId, annotationId: NodeId): NodeId {
    const appId = `${target}@${annotationId}`;
    this.stageNode(appId, Tier.Ontology, annotationId);
    this.stagedEdges.push({ kind: EdgeKind.Annotated, via: null, from: target, to: appId });
    return appId;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/model/tests/builder-annotation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model/kinds.ts src/model/graph.ts src/model/builder.ts src/model/tests/builder-annotation.test.ts
git commit -m "feat(model): annotation/package graph kinds + Builder.annotate"
```

---

## Task 3: Loader — annotation defs, params, applications, package node, duplicate

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (`DiagnosticCode`, add `AnnotationDuplicate`)
- Modify: `src/parse/loader.ts` (imports; pass 1; pass 2a; new applications pass; `collectNames`; `recordSpans`)
- Test: `src/parse/tests/loader-annotation.test.ts` (create)

**Interfaces:**
- Consumes: `Builder.defineAnnotation`/`definePackageNode`/`annotate` (Task 2); `PACKAGE_NODE_ID`; existing `applyValue`, `setNamespace`, `addField`, `commit`, the `units: {ns, decl}[]` pass structure, `collectInstanceNames`, `RefSite`.
- Produces: for `annotate Icon { path = "…" }` on `concept actor`: node `actor@Icon` (Ontology, `typeOf=Icon`, attr `path`), `Annotated` edge `actor→actor@Icon`, `namespace` attr; annotation-def node `Icon` (`MetaKind.Annotation`) with `HasField` param `Icon.path`; a duplicate application emits `annotation.duplicate` and is not staged.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/loader-annotation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { Tier, EdgeKind, Direction } from "../../model/graph.js";
import { MetaKind, PACKAGE_NODE_ID } from "../../model/kinds.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const SRC = `namespace acme {
  annotation Icon { path : string; }
  annotation Author { name : string; }
  package { annotate Author { name = "Acme"; } }
  concept actor {
    annotate Icon { path = "icons/actor.svg"; }
    label : string;
  }
}`;

test("an annotation loads as an Ontology-tier node with HasField params", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  const n = model.resolve("Icon");
  assert.equal(n!.tier, Tier.Ontology);
  assert.equal(n!.typeOf, MetaKind.Annotation);
  assert.equal(model.resolve("Icon.path")!.typeOf, MetaKind.Field);
});

test("an application loads as an Annotated node typed by the annotation", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  const app = model.resolve("actor@Icon");
  assert.equal(app!.tier, Tier.Ontology);
  assert.equal(app!.typeOf, "Icon");
  assert.equal(app!.attrs.get("path"), "icons/actor.svg");
  assert.equal(app!.attrs.get("namespace"), "acme");
  assert.deepEqual(model.related("actor", EdgeKind.Annotated, Direction.Out), ["actor@Icon"]);
});

test("package annotations attach to the singleton package node", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  assert.equal(model.resolve(PACKAGE_NODE_ID)!.typeOf, MetaKind.Package);
  assert.deepEqual(model.related(PACKAGE_NODE_ID, EdgeKind.Annotated, Direction.Out), ["package@Author"]);
});

test("a duplicate application on one target is annotation.duplicate", () => {
  const dup = `namespace acme {
    annotation Icon { path : string; }
    concept actor {
      annotate Icon { path = "a.svg"; }
      annotate Icon { path = "b.svg"; }
    }
  }`;
  const { diagnostics } = load([{ uri: "a.todl", text: dup }]);
  assert.ok(diagnostics.map((d) => d.code).includes(DiagnosticCode.AnnotationDuplicate));
});

test("annotating an undefined annotation is reference.undefined", () => {
  const bad = `namespace acme { concept actor { annotate Ghost { x = "y"; } } }`;
  const { diagnostics } = load([{ uri: "a.todl", text: bad }]);
  assert.ok(diagnostics.map((d) => d.code).includes(DiagnosticCode.ReferenceUndefined));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/loader-annotation.test.ts`
Expected: FAIL — loader has no annotation handling; `AnnotationDuplicate` missing.

- [ ] **Step 3: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, under the `// Model phase.` group (after `ConstructorOutOfScope`):

```ts
  // Annotation phase.
  AnnotationDuplicate = "annotation.duplicate",
```

- [ ] **Step 4: Loader imports + pass 1 + pass 2a**

In `src/parse/loader.ts`, add to the ast import group: `type AnnotationDecl,` and `type AnnotationApplication,`. Add `PACKAGE_NODE_ID` to the kinds import, and `Severity`/`DiagnosticCode` are already imported.

In **Pass 1** (the `for (const { ns, decl: declaration } of units)` switch), add cases:

```ts
      case DeclKind.Annotation:
        first.defineAnnotation(declaration.name);
        break;
      case DeclKind.Package:
        break; // staged in the applications pass
```

In **Pass 2a** (concept members), handle annotations before the concept guard:

```ts
  for (const { ns, decl: declaration } of units) {
    if (declaration.kind === DeclKind.Annotation) {
      second.setNamespace(ns);
      for (const p of declaration.params) second.addField(declaration.name, p.name, p.type, p.cardinality);
      continue;
    }
    if (declaration.kind !== DeclKind.Concept) continue;
    second.setNamespace(ns);
    // …existing concept field/relationship/invariant body unchanged…
  }
```

- [ ] **Step 5: Add the applications pass**

In `src/parse/loader.ts`, after Pass 2b's `third.commit(undefinedIds);`, add:

```ts
  // Applications pass: annotation applications on concepts + package. Runs after
  // member schemas are committed. A duplicate `<target>@<Ann>` is diagnosed and
  // skipped (the builder would throw on the duplicate node id).
  const fourth = model.builder();
  const seenApps = new Set<string>();
  let packageStaged = false;
  for (const { ns, decl } of units) {
    if (decl.kind === DeclKind.Concept) {
      fourth.setNamespace(ns);
      stageApplications(fourth, model, decl.name, decl.annotations, seenApps, diagnostics);
    } else if (decl.kind === DeclKind.Package) {
      fourth.setNamespace(ns);
      if (!packageStaged) { fourth.definePackageNode(PACKAGE_NODE_ID); packageStaged = true; }
      stageApplications(fourth, model, PACKAGE_NODE_ID, decl.annotations, seenApps, diagnostics);
    }
  }
  fourth.commit(undefinedIds);
```

Add the helper (near `applyModel`):

```ts
function stageApplications(
  builder: Builder,
  model: Repository,
  target: string,
  apps: readonly AnnotationApplication[],
  seen: Set<string>,
  diagnostics: Diagnostic[],
): void {
  for (const app of apps) {
    const appId = `${target}@${app.name}`;
    if (seen.has(appId)) {
      diagnostics.push({
        code: DiagnosticCode.AnnotationDuplicate,
        severity: Severity.Error,
        message: `annotation "${app.name}" is already applied to "${target}"`,
        span: app.nameSpan ?? app.span,
        node: appId,
        path: null,
      });
      continue;
    }
    seen.add(appId);
    builder.annotate(target, app.name);
    model.recordSpan(appId, app.span);
    for (const a of app.assignments) applyValue(builder, appId, a.name, a.value);
  }
}
```

- [ ] **Step 6: `collectNames` + `recordSpans` cases**

In `collectNames` (`src/parse/loader.ts`), add cases so the annotation name is defined and each application's annotation name is a reference site:

```ts
    case DeclKind.Annotation:
      defined.add(declaration.name);
      break;
    case DeclKind.Package:
      for (const app of declaration.annotations) {
        sites.push({ id: app.name, span: app.nameSpan ?? app.span, node: `${PACKAGE_NODE_ID}@${app.name}`, path: null });
      }
      break;
```

In the existing `collectNames` `DeclKind.Concept` case, after adding the concept name/extends, also register its applications as reference sites:

```ts
      for (const app of declaration.annotations) {
        sites.push({ id: app.name, span: app.nameSpan ?? app.span, node: `${declaration.name}@${app.name}`, path: null });
      }
```

In `recordSpans`, add a case (annotation-def span; application spans are recorded in `stageApplications`):

```ts
      case DeclKind.Annotation:
        model.recordSpan(declaration.name, declaration.span);
        break;
      case DeclKind.Package:
        break; // application spans recorded during the applications pass
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/loader-annotation.test.ts`
Expected: PASS (all five).

- [ ] **Step 8: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/parse/loader.ts src/parse/tests/loader-annotation.test.ts
git commit -m "feat(parse): load annotations into the graph; annotation.duplicate"
```

---

## Task 4: Validation — typed param checking

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (`DiagnosticCode`, add `AnnotationUnknownParam`)
- Modify: `src/validate/validate.ts` (`validate` dispatch; add `validateAnnotationApplication`)
- Test: `src/validate/tests/validate-annotation.test.ts` (create)

**Interfaces:**
- Produces: `DiagnosticCode.AnnotationUnknownParam = "annotation.unknown-param"`.
- Consumes: `Repository.{allNodes,resolve,effectiveSchema,spanOf}`, `Tier`, `MetaKind`, `Cardinality`.

Note: TODL does not validate scalar field *values* against primitive types anywhere (concepts don't either), so SP1 validates param **presence** and **name**, not value-type — consistent with concepts. Value-type validation is deferred.

- [ ] **Step 1: Write the failing test**

Create `src/validate/tests/validate-annotation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (text: string) => check([{ uri: "a.todl", text }]).diagnostics.map((d) => d.code);

test("a valid application produces no annotation diagnostics", () => {
  const c = codes(`namespace a {
    annotation Icon { path : string; }
    concept actor { annotate Icon { path = "a.svg"; } }
  }`);
  assert.ok(!c.includes(DiagnosticCode.AnnotationUnknownParam));
  assert.ok(!c.includes(DiagnosticCode.RequiredMissing));
});

test("an undeclared param is annotation.unknown-param", () => {
  const c = codes(`namespace a {
    annotation Icon { path : string; }
    concept actor { annotate Icon { path = "a.svg"; bogus = "x"; } }
  }`);
  assert.ok(c.includes(DiagnosticCode.AnnotationUnknownParam));
});

test("a missing required param is cardinality.required-missing", () => {
  const c = codes(`namespace a {
    annotation Icon { path : string; }
    concept actor { annotate Icon { } }
  }`);
  assert.ok(c.includes(DiagnosticCode.RequiredMissing));
});

test("an optional param may be omitted", () => {
  const c = codes(`namespace a {
    annotation Category { name : string; order : number?; }
    concept actor { annotate Category { name = "actors"; } }
  }`);
  assert.ok(!c.includes(DiagnosticCode.RequiredMissing));
  assert.ok(!c.includes(DiagnosticCode.AnnotationUnknownParam));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/validate/tests/validate-annotation.test.ts`
Expected: FAIL — `AnnotationUnknownParam` missing; no application validation runs.

- [ ] **Step 3: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, under `// Annotation phase.`:

```ts
  AnnotationUnknownParam = "annotation.unknown-param",
```

- [ ] **Step 4: Dispatch + validate applications**

In `src/validate/validate.ts`, in the `validate` loop, add a branch before `if (node.tier !== Tier.Instance) continue;`:

```ts
    if (node.tier === Tier.Ontology) {
      const def = model.resolve(node.typeOf);
      if (def !== undefined && def.typeOf === MetaKind.Annotation) {
        validateAnnotationApplication(diagnostics, model, node);
        continue;
      }
    }
```

Add the function (`Cardinality` is already imported in this file):

```ts
/** Validate an annotation application against its annotation's declared params. */
function validateAnnotationApplication(out: Diagnostic[], model: Repository, node: Node): void {
  const schema = model.effectiveSchema(node.typeOf);
  const declared = new Set(schema.fields.map((f) => f.name));

  for (const key of node.attrs.keys()) {
    if (key === "namespace") continue; // provenance, not a param
    if (!declared.has(key)) {
      out.push({
        code: DiagnosticCode.AnnotationUnknownParam,
        severity: Severity.Error,
        message: `annotation "${node.typeOf}" has no parameter "${key}"`,
        span: model.spanOf(node.id),
        node: node.id,
        path: null,
      });
    }
  }

  for (const f of schema.fields) {
    const required = f.cardinality === Cardinality.One || f.cardinality === Cardinality.NonEmpty;
    if (required && !node.attrs.has(f.name)) {
      out.push({
        code: DiagnosticCode.RequiredMissing,
        severity: Severity.Error,
        message: `annotation "${node.typeOf}" requires parameter "${f.name}"`,
        span: model.spanOf(node.id),
        node: node.id,
        path: null,
      });
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/validate/tests/validate-annotation.test.ts`
Expected: PASS (all four).

- [ ] **Step 6: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/validate/validate.ts src/validate/tests/validate-annotation.test.ts
git commit -m "feat(validate): annotation param validation (unknown/required)"
```

---

## Task 5: Emit round-trip regression guard

**Files:**
- Test: `src/emit/tests/annotation-roundtrip.test.ts` (create)

**Interfaces:** Consumes `check`, `toJSON`, `fromJSON`; asserts annotation nodes/edges/attrs survive serialization. No production code — proves emit is unaffected and guards it.

- [ ] **Step 1: Write the test**

Create `src/emit/tests/annotation-roundtrip.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON, fromJSON } from "../json.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { MetaKind } from "../../model/kinds.js";

test("annotation def, application node, Annotated edge, and params round-trip", () => {
  const { model } = check([{ uri: "a.todl", text:
    `namespace acme {
      annotation Icon { path : string; }
      concept actor { annotate Icon { path = "a.svg"; } }
    }` }]);
  const restored = fromJSON(toJSON(model));

  assert.equal(restored.resolve("Icon")!.typeOf, MetaKind.Annotation);
  const app = restored.resolve("actor@Icon");
  assert.equal(app!.typeOf, "Icon");
  assert.equal(app!.attrs.get("path"), "a.svg");
  assert.deepEqual(restored.related("actor", EdgeKind.Annotated, Direction.Out), ["actor@Icon"]);
});
```

- [ ] **Step 2: Run the test**

Run: `cd TODL && npx tsx --conditions=development --test src/emit/tests/annotation-roundtrip.test.ts`
Expected: PASS immediately (emit serializes all nodes/edges/attrs). If it fails, investigate `toJSON`/`fromJSON` before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/emit/tests/annotation-roundtrip.test.ts
git commit -m "test(emit): annotation graph round-trip"
```

---

## Task 6: Migration + version bump + full green suite

**Files:**
- Modify: `package.json` (version 0.4.0 → 0.5.0)
- Modify (as needed): any fixture using `annotation` / `annotate` / `package` as an identifier.

- [ ] **Step 1: Run the full suite to find breakage**

Run: `cd TODL && npm test`
Expected: possible failures in fixtures that use the now-reserved words `annotation` / `annotate` / `package` as concept or record names. Record each.

- [ ] **Step 2: Migrate broken fixtures**

For each failure, rename the offending identifier (e.g. a `concept package { }` or a record named `annotate`) to a non-reserved name, keeping the test's intent. A `package` used as a top-level record now parses as a `package { }` block — such fixtures must be renamed. Do not weaken assertions beyond what the new reserved words require.

- [ ] **Step 3: Run the typecheck**

Run: `cd TODL && npx tsc --noEmit`
Expected: clean. Fix any exhaustive-switch gaps introduced by the new `DeclKind` members (e.g. a `switch (decl.kind)` needing `Annotation`/`Package` cases) the same way — add the missing cases.

- [ ] **Step 4: Bump the version**

In `package.json`:

```json
  "version": "0.5.0",
```

- [ ] **Step 5: Run the full suite to verify green**

Run: `cd TODL && npm test`
Expected: PASS — all suites green, including the five new test files.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(todl): reserve annotation/annotate/package keywords; bump to 0.5.0"
```

---

## Self-Review Notes (author)

- **Spec coverage:** §3 surface → Task 1; §4 AST/parser → Task 1; §5 graph model (annotation def, application node, package node, provenance) → Tasks 2–3; §6 builder/loader → Tasks 2–3; §7 validation → Task 3 (duplicate, reference.undefined) + Task 4 (unknown-param, required-missing); §8 emit → Task 5; §9 migration/version → Task 6; §10 testing → per-task + Task 6.
- **Deliberate spec deviation:** §7.4 "param value type mismatch (reuse existing primitive checks)" is dropped — TODL has no scalar-value/primitive validation to reuse, and concepts don't validate values either, so annotations stay consistent. Value-type validation is deferred (documented in Task 4).
- **Type consistency:** application id `${target}@${annotationId}` is identical across Tasks 2 (`annotate`), 3 (`stageApplications`, `collectNames`, tests), 4 (validation reads `node.typeOf`/`node.id`), 5. `PACKAGE_NODE_ID = "package"` reused in Tasks 2/3/5. `MetaKind.Annotation`/`Package`, `EdgeKind.Annotated`, `AnnotationDuplicate`/`AnnotationUnknownParam` consistent across their tasks. `effectiveSchema(node.typeOf).fields` (Task 4) matches the annotation's `HasField` params staged in Task 3.
- **Release/SP2/SP3** (Verdaccio republish of 0.5.0, Plexus projection + manifest, presentation hybrid + Mural) are out of this plan.
