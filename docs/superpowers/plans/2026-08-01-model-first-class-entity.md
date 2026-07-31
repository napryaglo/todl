# Model as a First-Class Entity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `model` a first-class TODL construct — an Instance-tier container that is the sole carrier of concrete objects, binds one meta-model + libraries, and enforces containment and constructor-scope via per-node namespace provenance.

**Architecture:** A new `DeclKind.Model` / `ModelDecl` AST node parsed by a reserved `model` keyword; the loader stages a `MetaKind.Model`-typed Instance-tier node owning its objects via `Contains`; every staged node is stamped with a `namespace` provenance attr that round-trips through emit's existing attr serialization; three new diagnostics (`instance.orphan`, `model.binding-undefined`, `constructor.out-of-scope`) enforce the rules.

**Tech Stack:** TypeScript (ESM, strict), `tsx --test` runner, `@pragmatic-lab/todl`.

**Spec:** `docs/superpowers/specs/2026-08-01-model-first-class-entity-design.md`

## Global Constraints

- Target version: **`@pragmatic-lab/todl` 0.4.0** (breaking). Bump `package.json` in the final task.
- Every test file lives in a `tests/` subfolder next to the code it exercises (e.g. `src/parse/tests/model.test.ts`).
- Test runner: `npm test` = `tsx --conditions=development --test "src/**/*.test.ts"`. Single file: `tsx --conditions=development --test src/parse/tests/<file>.test.ts`.
- Enums, not string-literal unions.
- `namespace` provenance is a per-node scalar attr named exactly `"namespace"`. The `uses` library list is stored as scalar attrs `uses.count` (number) + `uses.0`…`uses.N` (strings). The meta-model is the scalar attr `"meta-model"`.
- All three new diagnostics are `Severity.Error`.
- Work on branch `model-first-class-entity` (base `main`).

---

## File Structure

- `src/parse/ast.ts` — add `DeclKind.Model`, `ModelDecl`, extend `Declaration` union. (Task 1)
- `src/parse/parser.ts` — `parseModel`, dispatch in `parseDeclaration`. (Task 1)
- `src/model/kinds.ts` — add `MetaKind.Model`. (Task 1)
- `src/model/builder.ts` — `assertModel`, `setNamespace`, per-node namespace stamping. (Task 2)
- `src/parse/loader.ts` — namespace-per-declaration threading, model load branch, `collectNames`/`recordSpans` cases, orphan detection. (Tasks 3, 4)
- `src/diagnostics/diagnostic.ts` — three new `DiagnosticCode` members. (Tasks 4, 5, 6)
- `src/validate/validate.ts` — `validateModel` (binding + constructor scope). (Tasks 5, 6)
- `package.json` — version bump. (Task 8)

---

## Task 1: `model` keyword → `ModelDecl` (AST + parser + MetaKind)

**Files:**
- Modify: `src/parse/ast.ts` (`DeclKind` enum ~line 12, add `ModelDecl`, extend `Declaration` ~line 170)
- Modify: `src/parse/parser.ts` (`parseDeclaration` ~line 162, add `parseModel`)
- Modify: `src/model/kinds.ts` (`MetaKind` enum)
- Test: `src/parse/tests/model.test.ts` (create)

**Interfaces:**
- Produces: `ModelDecl { kind: DeclKind.Model; id: string; metaModel: string; libraries: string[]; instances: InstanceDecl[]; span: SourceSpan; idSpan?: SourceSpan; metaModelSpan?: SourceSpan; librarySpans?: SourceSpan[] }`
- Produces: `MetaKind.Model = "model"`
- Consumes existing: `parseInstanceFrom(concept, start, isClass, conceptSpan?)`, `parseEdgeRecord`, `parseApplicationConnectors`, `tokenSpan(tok, uri)`, `TokenKind.{Colon,LBrace,RBrace,Comma,Amp,Identifier}`, `this.checkKeyword`, `this.expectKeyword`, `this.expect`, `this.match`, `this.startToken`, `this.spanFrom`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/model.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type ModelDecl } from "../ast.js";

function firstDecl(text: string) {
  const { namespace, diagnostics } = parse(text, "test.todl");
  assert.deepEqual(diagnostics, [], "expected no parse diagnostics");
  return namespace.declarations[0];
}

test("model parses to a ModelDecl with meta-model, uses, and object body", () => {
  const decl = firstDecl(`namespace acme {
    model prod : enterprise-architecture uses aws-catalog, ea-patterns {
      component checkout { name = "Checkout"; }
      component payments instanceof payment-service { name = "Payments"; }
    }
  }`) as ModelDecl;
  assert.equal(decl.kind, DeclKind.Model);
  assert.equal(decl.id, "prod");
  assert.equal(decl.metaModel, "enterprise-architecture");
  assert.deepEqual(decl.libraries, ["aws-catalog", "ea-patterns"]);
  assert.equal(decl.instances.length, 2);
  assert.equal(decl.instances[0]!.concept, "component");
  assert.equal(decl.instances[1]!.instanceOf, "payment-service");
  assert.ok(decl.idSpan && decl.metaModelSpan && decl.librarySpans?.length === 2);
});

test("model with no uses list parses with empty libraries", () => {
  const decl = firstDecl(`namespace acme {
    model prod : ea { component c { } }
  }`) as ModelDecl;
  assert.equal(decl.kind, DeclKind.Model);
  assert.deepEqual(decl.libraries, []);
  assert.equal(decl.instances.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/model.test.ts`
Expected: FAIL — `DeclKind.Model` / `ModelDecl` do not exist, or `model` parses as a generic instance record.

- [ ] **Step 3: Extend the AST**

In `src/parse/ast.ts`, add `Model` to `DeclKind`:

```ts
export enum DeclKind {
  Primitive,
  Taxonomy,
  Concept,
  Instance,
  Model,
}
```

Add the `ModelDecl` interface (place it after `InstanceDecl`):

```ts
export interface ModelDecl {
  kind: DeclKind.Model;
  id: string;
  /** The bound meta-model (`: <meta-model>`) — required. */
  metaModel: string;
  /** The `uses <lib>, …` library list; empty when omitted. */
  libraries: string[];
  /** The concrete objects this model carries. */
  instances: InstanceDecl[];
  span: SourceSpan;
  idSpan?: SourceSpan;
  metaModelSpan?: SourceSpan;
  /** Span of each `uses` library identifier, parallel to `libraries`. */
  librarySpans?: SourceSpan[];
}
```

Extend the `Declaration` union:

```ts
export type Declaration = ConceptDecl | TaxonomyDecl | PrimitiveDecl | InstanceDecl | ModelDecl;
```

- [ ] **Step 4: Add `MetaKind.Model`**

In `src/model/kinds.ts`:

```ts
export enum MetaKind {
  Concept = "concept",
  Primitive = "primitive",
  Taxonomy = "taxonomy",
  Field = "field",
  Relationship = "relationship",
  Model = "model",
}
```

- [ ] **Step 5: Add the parser dispatch + `parseModel`**

In `src/parse/parser.ts`, import `ModelDecl` in the ast import group. In `parseDeclaration`, add the `model` branch alongside the other keyword checks (after the `concept` check, before the `class` check):

```ts
    if (this.checkKeyword("model")) return this.parseModel(start);
```

Add the method (place it right after `parseInstanceFrom`):

```ts
  /**
   * Parse a model: `model <id> : <meta-model> [uses <lib>, …] { <objects> }`.
   * The body reuses instance-record parsing for each contained object.
   */
  private parseModel(start: Token): ModelDecl {
    this.expectKeyword("model");
    const idTok = this.expect(TokenKind.Identifier);
    this.expect(TokenKind.Colon);
    const metaTok = this.expect(TokenKind.Identifier);
    const libraries: string[] = [];
    const librarySpans: SourceSpan[] = [];
    if (this.checkKeyword("uses")) {
      this.advance();
      do {
        const libTok = this.expect(TokenKind.Identifier);
        libraries.push(libTok.value);
        librarySpans.push(tokenSpan(libTok, this.uri));
      } while (this.match(TokenKind.Comma));
    }
    const instances: InstanceDecl[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const memberStart = this.startToken();
      if (this.checkKeyword("application-connectors")) {
        instances.push(this.parseApplicationConnectors(memberStart));
        continue;
      }
      const first = this.expect(TokenKind.Identifier);
      if (this.check(TokenKind.Amp)) {
        instances.push(this.parseEdgeRecord(first.value, memberStart));
        continue;
      }
      instances.push(this.parseInstanceFrom(first.value, memberStart, false, tokenSpan(first, this.uri)));
    }
    this.expect(TokenKind.RBrace);
    const decl: ModelDecl = {
      kind: DeclKind.Model,
      id: idTok.value,
      metaModel: metaTok.value,
      libraries,
      instances,
      span: this.spanFrom(start),
    };
    decl.idSpan = tokenSpan(idTok, this.uri);
    decl.metaModelSpan = tokenSpan(metaTok, this.uri);
    if (librarySpans.length > 0) decl.librarySpans = librarySpans;
    return decl;
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/model.test.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/model/kinds.ts src/parse/tests/model.test.ts
git commit -m "feat(parse): model keyword parses to ModelDecl; add MetaKind.Model"
```

---

## Task 2: Builder — `assertModel` + per-node namespace stamping

**Files:**
- Modify: `src/model/builder.ts` (add field + `setNamespace` + `assertModel`; stamp in `stageNode` ~line 216 and the three direct `stagedNodes.push` sites ~lines 110, 132, 156)
- Test: `src/model/tests/builder-namespace.test.ts` (create)

**Interfaces:**
- Produces: `Builder.setNamespace(ns: string): this` — sets the namespace stamped onto every subsequently-staged node until changed.
- Produces: `Builder.assertModel(id: NodeId): this` — stages an Instance-tier node typed by `MetaKind.Model`.
- Consumes: existing `Graph`, `Tier`, `MetaKind` (already imported in builder.ts), `Scalar`.

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/builder-namespace.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, Tier } from "../graph.js";
import { MetaKind } from "../kinds.js";
import { Builder } from "../builder.js";

test("assertModel stages an Instance-tier node typed by MetaKind.Model", () => {
  const graph = new Graph();
  new Builder(graph).assertModel("prod").commit();
  const node = graph.getNode("prod");
  assert.ok(node);
  assert.equal(node!.tier, Tier.Instance);
  assert.equal(node!.typeOf, MetaKind.Model);
});

test("setNamespace stamps a namespace attr on every staged node", () => {
  const graph = new Graph();
  new Builder(graph).setNamespace("acme").defineConcept("thing").assertInstance("thing", "t1").commit();
  assert.equal(graph.getNode("thing")!.attrs.get("namespace"), "acme");
  assert.equal(graph.getNode("t1")!.attrs.get("namespace"), "acme");
});

test("a field member node is stamped with the namespace too", () => {
  const graph = new Graph();
  const b = new Builder(graph).setNamespace("acme").defineConcept("thing");
  b.addField("thing", "label", "string");
  b.commit();
  assert.equal(graph.getNode("thing.label")!.attrs.get("namespace"), "acme");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/model/tests/builder-namespace.test.ts`
Expected: FAIL — `assertModel` / `setNamespace` do not exist.

- [ ] **Step 3: Add the field, setter, and `assertModel`**

In `src/model/builder.ts`, add a private field to the `Builder` class (next to `stagedNodes`):

```ts
  private currentNamespace: string | null = null;
```

Add the setter and `assertModel` (place `assertModel` in the Instance-tier section, next to `assertInstance`):

```ts
  /** Stamp `ns` as the `namespace` provenance attr on every node staged after this call. */
  setNamespace(ns: string): this {
    this.currentNamespace = ns;
    return this;
  }

  /** Stage a model container node (Instance-tier, typed by the Model sentinel). */
  assertModel(id: NodeId): this {
    this.stageNode(id, Tier.Instance, MetaKind.Model);
    return this;
  }
```

- [ ] **Step 4: Stamp the namespace at stage time**

Change `stageNode` (~line 216) to seed the namespace attr:

```ts
  private stageNode(id: NodeId, tier: Tier, typeOf: NodeId): void {
    const attrs = new Map<string, Scalar>();
    if (this.currentNamespace !== null) attrs.set("namespace", this.currentNamespace);
    this.stagedNodes.push({ id, tier, typeOf, attrs });
  }
```

For the three member/term nodes staged directly (they build their own `attrs` map — the `addField` push ~line 110, the `addConceptRelationship` push ~line 132, and the `defineTaxonomy` term push ~line 156), add this line immediately before each `this.stagedNodes.push({ id …, attrs })`:

```ts
    if (this.currentNamespace !== null) attrs.set("namespace", this.currentNamespace);
```

(Each of those three sites already has a local `const attrs = new Map<string, Scalar>([...])`; add the stamp to each.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/model/tests/builder-namespace.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model/builder.ts src/model/tests/builder-namespace.test.ts
git commit -m "feat(model): Builder.assertModel + per-node namespace stamping"
```

---

## Task 3: Loader — model load branch + namespace threading + spans

**Files:**
- Modify: `src/parse/loader.ts` (flatten ~line 63; passes ~lines 82, 168, 192; `deferredCompositions` ~line 76/199; `collectNames` ~line 246; `recordSpans` ~line 213; add `applyModel`)
- Test: `src/parse/tests/loader-model.test.ts` (create)

**Interfaces:**
- Consumes: `Builder.setNamespace`, `Builder.assertModel` (Task 2); `applyInstance(builder, model, decl, parent, parentConcept, asserted, diagnostics)`; `Repository.memberKey`, `recordSpan`, `recordInstanceSpans`, `collectInstanceNames`.
- Produces: for the loaded model, a graph node `<id>` with `tier=Instance`, `typeOf=MetaKind.Model`, attrs `id`, `meta-model`, `uses.count`, `uses.0…N`, `namespace`; a `Contains` edge to each contained object; every object + its concept + member nodes carry a `namespace` attr.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/loader-model.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { Tier, EdgeKind, Direction } from "../../model/graph.js";
import { MetaKind } from "../../model/kinds.js";

const SRC = `namespace acme {
  concept component { name : string; }
  model prod : acme uses aws-catalog {
    component checkout { name = "Checkout"; }
  }
}`;

test("a model loads as an Instance-tier MetaKind.Model node with binding attrs", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  const node = model.resolve("prod");
  assert.ok(node);
  assert.equal(node!.tier, Tier.Instance);
  assert.equal(node!.typeOf, MetaKind.Model);
  assert.equal(node!.attrs.get("meta-model"), "acme");
  assert.equal(node!.attrs.get("uses.count"), 1);
  assert.equal(node!.attrs.get("uses.0"), "aws-catalog");
});

test("the model contains its objects via Contains", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  const contained = model.related("prod", EdgeKind.Contains, Direction.Out);
  assert.deepEqual(contained, ["checkout"]);
});

test("every loaded node carries its source namespace as provenance", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  assert.equal(model.resolve("prod")!.attrs.get("namespace"), "acme");
  assert.equal(model.resolve("checkout")!.attrs.get("namespace"), "acme");
  assert.equal(model.resolve("component")!.attrs.get("namespace"), "acme");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/loader-model.test.ts`
Expected: FAIL — the loader has no `DeclKind.Model` handling; `prod` is either absent or mis-typed and carries no namespace.

- [ ] **Step 3: Thread namespace-per-declaration**

In `loadInto` (`src/parse/loader.ts`), replace the flatten (~lines 63–67) with a namespace-preserving unit list, keeping a bare `declarations` array for the read-only loops:

```ts
  const units: { ns: string; decl: Declaration }[] = [];
  for (const source of sources) {
    const result = parse(source.text, source.uri);
    diagnostics.push(...result.diagnostics);
    for (const decl of result.namespace.declarations) {
      units.push({ ns: result.namespace.path, decl });
    }
  }
  const declarations = units.map((u) => u.decl);
```

Set the namespace before staging in each pass that stages nodes. Pass 1 (~line 82) — change the loop header to iterate `units` and set the namespace first:

```ts
  const first = model.builder();
  for (const { ns, decl: declaration } of units) {
    first.setNamespace(ns);
    switch (declaration.kind) {
      // …existing cases unchanged…
      case DeclKind.Instance:
        break;
      case DeclKind.Model:
        break; // staged in pass 2b
    }
  }
```

Pass 2a (concept members, ~line 168) — iterate `units` and set the namespace:

```ts
  const second = model.builder();
  const invariants: PendingInvariant[] = [];
  for (const { ns, decl: declaration } of units) {
    if (declaration.kind !== DeclKind.Concept) continue;
    second.setNamespace(ns);
    // …existing field/relationship/invariant body unchanged…
  }
```

- [ ] **Step 4: Add the model load branch (pass 2b)**

Add the `ns` field to the `deferredCompositions` element type (~line 76) so its namespace survives:

```ts
  const deferredCompositions: { ns: string; parentId: string; parentConcept: string; decl: InstanceDecl }[] = [];
```

When a deferred composition is pushed inside the Pass-1 taxonomy handling (~line 114), include `ns` (the Pass-1 loop now destructures `ns`):

```ts
              deferredCompositions.push({
                ns,
                parentId: `${decl.name}.${t.id}`,
                parentConcept: ownConcept,
                decl: termToInstanceDecl(decl.name, child),
              });
```

Rewrite Pass 2b (~line 190) to iterate `units`, set the namespace, and branch on `Model`:

```ts
  const third = model.builder();
  const asserted = new Set<string>();
  for (const { ns, decl: declaration } of units) {
    third.setNamespace(ns);
    if (declaration.kind === DeclKind.Instance) {
      applyInstance(third, model, declaration, null, null, asserted, diagnostics);
    } else if (declaration.kind === DeclKind.Model) {
      applyModel(third, model, declaration, asserted, diagnostics);
    }
  }
  for (const composition of deferredCompositions) {
    third.setNamespace(composition.ns);
    applyInstance(third, model, composition.decl, composition.parentId, composition.parentConcept, asserted, diagnostics);
  }
  third.commit(undefinedIds);
```

Add the `applyModel` function (near `applyInstance`, ~line 377). Import `ModelDecl` in the ast import group at the top of the file:

```ts
/** Stage a model container node and its contained objects (rooted via Contains). */
function applyModel(
  builder: Builder,
  model: Repository,
  decl: ModelDecl,
  asserted: Set<string>,
  diagnostics: Diagnostic[],
): void {
  builder.assertModel(decl.id);
  builder.setField(decl.id, "id", decl.id);
  builder.setField(decl.id, "meta-model", decl.metaModel);
  builder.setField(decl.id, "uses.count", decl.libraries.length);
  decl.libraries.forEach((lib, i) => builder.setField(decl.id, `uses.${i}`, lib));
  asserted.add(decl.id);
  for (const child of decl.instances) {
    applyInstance(builder, model, child, decl.id, null, asserted, diagnostics);
  }
}
```

- [ ] **Step 5: Handle `collectNames` and `recordSpans`**

In `collectNames` (~line 246), add a `Model` case so contained-object ids and their reference sites are collected:

```ts
    case DeclKind.Model:
      defined.add(declaration.id);
      for (const inst of declaration.instances) collectInstanceNames(inst, defined, sites);
      break;
```

In `recordSpans` (~line 213), add a `Model` case:

```ts
      case DeclKind.Model:
        model.recordSpan(declaration.id, declaration.span);
        if (declaration.metaModelSpan !== undefined) {
          model.recordSpan(Repository.memberKey(declaration.id, "meta-model"), declaration.metaModelSpan);
        }
        declaration.librarySpans?.forEach((s, i) =>
          model.recordSpan(Repository.memberKey(declaration.id, `uses.${i}`), s),
        );
        for (const inst of declaration.instances) recordInstanceSpans(model, inst);
        break;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/loader-model.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 7: Commit**

```bash
git add src/parse/loader.ts src/parse/tests/loader-model.test.ts
git commit -m "feat(parse): load model nodes with Contains objects + namespace provenance"
```

---

## Task 4: `instance.orphan` — objects must have a model ancestor

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (`DiagnosticCode`, add `InstanceOrphan`)
- Modify: `src/parse/loader.ts` (add `detectOrphans` + call it in `loadInto`)
- Test: `src/parse/tests/loader-orphan.test.ts` (create)

**Interfaces:**
- Produces: `DiagnosticCode.InstanceOrphan = "instance.orphan"`.
- Consumes: existing `WRAPPER_CONCEPTS` set (loader.ts ~line 375), `Severity`, `Diagnostic`, `DeclKind`, `InstanceDecl`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/loader-orphan.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (text: string) =>
  load([{ uri: "a.todl", text }]).diagnostics.map((d) => d.code);

test("a top-level concrete object is an orphan", () => {
  const c = codes(`namespace acme {
    concept component { }
    component checkout { }
  }`);
  assert.ok(c.includes(DiagnosticCode.InstanceOrphan));
});

test("an object inside a model is not an orphan", () => {
  const c = codes(`namespace acme {
    concept component { }
    model prod : acme { component checkout { } }
  }`);
  assert.ok(!c.includes(DiagnosticCode.InstanceOrphan));
});

test("a top-level class is not an orphan", () => {
  const c = codes(`namespace acme {
    concept component { }
    class component base { }
  }`);
  assert.ok(!c.includes(DiagnosticCode.InstanceOrphan));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/loader-orphan.test.ts`
Expected: FAIL — `DiagnosticCode.InstanceOrphan` does not exist; no orphan is reported.

- [ ] **Step 3: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, add to `DiagnosticCode` (after `ReferenceUndefined`):

```ts
  // Model phase.
  InstanceOrphan = "instance.orphan",
```

- [ ] **Step 4: Add `detectOrphans` and call it**

In `src/parse/loader.ts`, add the detector (near `applyInstance`):

```ts
/**
 * A concrete object (`isClass = false`) is legal only inside a model. Walk the
 * top-level declarations: a `model` subtree is legal (skip it); any other
 * declaration is scanned for concrete objects with no model ancestor, and each
 * is flagged. Classes and transparent wrappers are recursed through, not flagged.
 */
function detectOrphans(declarations: Declaration[], diagnostics: Diagnostic[]): void {
  for (const declaration of declarations) {
    if (declaration.kind === DeclKind.Instance) flagOrphans(declaration, diagnostics);
  }
}

function flagOrphans(decl: InstanceDecl, diagnostics: Diagnostic[]): void {
  if (WRAPPER_CONCEPTS.has(decl.concept)) {
    for (const child of decl.children) flagOrphans(child, diagnostics);
    return;
  }
  if (decl.isClass) {
    for (const child of decl.children) flagOrphans(child, diagnostics);
    return;
  }
  diagnostics.push({
    code: DiagnosticCode.InstanceOrphan,
    severity: Severity.Error,
    message: `object "${decl.id}" must be declared inside a model`,
    span: decl.conceptSpan ?? decl.span,
    node: decl.id,
    path: null,
  });
}
```

Call it in `loadInto`, right after the `declarations` array is built (after the flatten in Task 3, before Pass 1):

```ts
  detectOrphans(declarations, diagnostics);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/parse/tests/loader-orphan.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/parse/loader.ts src/parse/tests/loader-orphan.test.ts
git commit -m "feat(parse): instance.orphan for objects without a model ancestor"
```

---

## Task 5: `model.binding-undefined` — bound modules must be loaded

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (`DiagnosticCode`, add `ModelBindingUndefined`)
- Modify: `src/validate/validate.ts` (`validate` dispatch ~line 39; add `validateModel`)
- Test: `src/validate/tests/validate-model-binding.test.ts` (create)

**Interfaces:**
- Produces: `DiagnosticCode.ModelBindingUndefined = "model.binding-undefined"`.
- Produces: `validateModel(out: Diagnostic[], model: Repository, node: Node): void` — reads `meta-model` / `uses.*` attrs and reports bound names that match no loaded module namespace.
- Consumes: `Repository.{allNodes,spanOf,resolve,closure,classOf}`, `Repository.memberKey`, `Tier`, `MetaKind`, `EdgeKind`, `Direction`.

- [ ] **Step 1: Write the failing test**

Create `src/validate/tests/validate-model-binding.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (text: string) => check([{ uri: "a.todl", text }]).diagnostics.map((d) => d.code);

test("binding a meta-model that is a loaded namespace is clean", () => {
  const c = codes(`namespace acme {
    concept component { }
    model prod : acme { component checkout { } }
  }`);
  assert.ok(!c.includes(DiagnosticCode.ModelBindingUndefined));
});

test("binding a meta-model no module provides is model.binding-undefined", () => {
  const c = codes(`namespace acme {
    concept component { }
    model prod : nonexistent { component checkout { } }
  }`);
  assert.ok(c.includes(DiagnosticCode.ModelBindingUndefined));
});

test("a uses library no module provides is model.binding-undefined", () => {
  const c = codes(`namespace acme {
    concept component { }
    model prod : acme uses ghost-lib { component checkout { } }
  }`);
  assert.ok(c.includes(DiagnosticCode.ModelBindingUndefined));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/validate/tests/validate-model-binding.test.ts`
Expected: FAIL — `ModelBindingUndefined` does not exist; nothing validates the model node.

- [ ] **Step 3: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, under the `// Model phase.` group:

```ts
  ModelBindingUndefined = "model.binding-undefined",
```

- [ ] **Step 4: Dispatch model nodes + add `validateModel`**

In `src/validate/validate.ts`, in the `validate` loop (~line 39), add a branch before `if (node.tier !== Tier.Instance) continue;`:

```ts
    if (node.tier === Tier.Instance && node.typeOf === MetaKind.Model) {
      validateModel(diagnostics, model, node);
      continue;
    }
```

Add the function (and a small helper to read the model's bound set — it is reused in Task 6):

```ts
/** The model's bound vocabulary: its meta-model plus each used library. */
function boundModules(node: Node): { metaModel: string | undefined; uses: string[]; set: Set<string> } {
  const metaModel = typeof node.attrs.get("meta-model") === "string"
    ? (node.attrs.get("meta-model") as string) : undefined;
  const count = typeof node.attrs.get("uses.count") === "number"
    ? (node.attrs.get("uses.count") as number) : 0;
  const uses: string[] = [];
  for (let i = 0; i < count; i++) {
    const lib = node.attrs.get(`uses.${i}`);
    if (typeof lib === "string") uses.push(lib);
  }
  const set = new Set<string>([...(metaModel ? [metaModel] : []), ...uses]);
  return { metaModel, uses, set };
}

function validateModel(out: Diagnostic[], model: Repository, node: Node): void {
  const { metaModel, uses } = boundModules(node);

  const present = new Set<string>();
  for (const n of model.allNodes()) {
    const ns = n.attrs.get("namespace");
    if (typeof ns === "string") present.add(ns);
  }

  const flagBinding = (name: string, member: string): void => {
    if (present.has(name)) return;
    out.push({
      code: DiagnosticCode.ModelBindingUndefined,
      severity: Severity.Error,
      message: `model "${node.id}" binds "${name}", but no loaded module provides it`,
      span: model.spanOf(Repository.memberKey(node.id, member)) ?? model.spanOf(node.id),
      node: node.id,
      path: null,
    });
  };
  if (metaModel !== undefined) flagBinding(metaModel, "meta-model");
  uses.forEach((lib, i) => flagBinding(lib, `uses.${i}`));
}
```

Add `Node` to the graph import and `Repository` is already imported. Ensure `MetaKind`, `EdgeKind`, `Direction` are imported (they are, per the file header).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/validate/tests/validate-model-binding.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/validate/validate.ts src/validate/tests/validate-model-binding.test.ts
git commit -m "feat(validate): model.binding-undefined for unresolved meta-model/uses"
```

---

## Task 6: `constructor.out-of-scope` — constructors must be in the bound vocabulary

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (`DiagnosticCode`, add `ConstructorOutOfScope`)
- Modify: `src/validate/validate.ts` (extend `validateModel`)
- Test: `src/validate/tests/validate-constructor-scope.test.ts` (create)

**Interfaces:**
- Produces: `DiagnosticCode.ConstructorOutOfScope = "constructor.out-of-scope"`.
- Consumes: `boundModules` (Task 5), `Repository.{closure,resolve,classOf,spanOf}`, `EdgeKind.Contains`, `Direction.Out`.

- [ ] **Step 1: Write the failing test**

Create `src/validate/tests/validate-constructor-scope.test.ts`. This uses `checkAgainst` with a compiled base so the two modules (`meta` and `lib`) have distinct namespaces:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (ds: { code: DiagnosticCode }[]) => ds.map((d) => d.code);

// Compile a meta-model + a library as bases, each in its own namespace.
function bases() {
  const meta = toJSON(check([{ uri: "meta.todl", text:
    `namespace meta { concept component { } }` }]).model);
  const lib = toJSON(check([{ uri: "lib.todl", text:
    `namespace lib { concept component { } class component ec2 { } }` }]).model);
  return [meta, lib];
}

test("constructors from the meta-model and a used library are in scope", () => {
  const src = `namespace app {
    model prod : meta uses lib {
      component a { }
      component b instanceof ec2 { }
    }
  }`;
  const { diagnostics } = checkAgainst(bases(), [{ uri: "app.todl", text: src }]);
  assert.ok(!codes(diagnostics).includes(DiagnosticCode.ConstructorOutOfScope));
});

test("a class from a library the model does not use is out of scope", () => {
  const src = `namespace app {
    model prod : meta {
      component b instanceof ec2 { }
    }
  }`;
  const { diagnostics } = checkAgainst(bases(), [{ uri: "app.todl", text: src }]);
  assert.ok(codes(diagnostics).includes(DiagnosticCode.ConstructorOutOfScope));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test src/validate/tests/validate-constructor-scope.test.ts`
Expected: FAIL — `ConstructorOutOfScope` does not exist; no scope check runs.

- [ ] **Step 3: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, under `// Model phase.`:

```ts
  ConstructorOutOfScope = "constructor.out-of-scope",
```

- [ ] **Step 4: Extend `validateModel` with the scope check**

In `src/validate/validate.ts`, append to `validateModel` (after the binding loop), and add the `checkConstructor` helper:

```ts
  const { set: bound } = boundModules(node);
  for (const objId of model.closure(node.id, EdgeKind.Contains, Direction.Out, false)) {
    const obj = model.resolve(objId);
    if (obj === undefined) continue;
    checkConstructor(out, model, obj, obj.typeOf, bound);    // the concept
    const cls = model.classOf(objId);
    if (cls !== null) checkConstructor(out, model, obj, cls, bound); // the instanceof class/term
  }
}

function checkConstructor(
  out: Diagnostic[],
  model: Repository,
  obj: Node,
  ctorId: NodeId,
  bound: Set<string>,
): void {
  const ctor = model.resolve(ctorId);
  if (ctor === undefined) return;
  const ns = ctor.attrs.get("namespace");
  if (typeof ns !== "string") return; // graceful degradation: unlabeled (old) base node
  if (bound.has(ns)) return;
  out.push({
    code: DiagnosticCode.ConstructorOutOfScope,
    severity: Severity.Error,
    message: `"${obj.id}" is built from "${ctorId}" (module "${ns}"), which is not in model's bound vocabulary`,
    span: model.spanOf(obj.id),
    node: obj.id,
    path: null,
  });
```

Note: the `checkConstructor` function closes the `validateModel` body — ensure the closing brace from Task 5's `validateModel` is moved so the `for` loop is inside `validateModel` and `checkConstructor` follows as a sibling function. Add `NodeId` to the graph import if not already present.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test src/validate/tests/validate-constructor-scope.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/validate/validate.ts src/validate/tests/validate-constructor-scope.test.ts
git commit -m "feat(validate): constructor.out-of-scope with graceful degradation"
```

---

## Task 7: Provenance round-trips through emit (regression guard)

**Files:**
- Test: `src/emit/tests/model-roundtrip.test.ts` (create)

**Interfaces:**
- Consumes: `toJSON`, `fromJSON`, `check`; asserts the model node + `namespace` attr survive serialization. No production code should be needed — this task proves the "free round-trip" claim and fails loudly if a future change breaks it.

- [ ] **Step 1: Write the test**

Create `src/emit/tests/model-roundtrip.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON, fromJSON } from "../json.js";
import { Tier } from "../../model/graph.js";
import { MetaKind } from "../../model/kinds.js";

test("a model node and namespace provenance survive toJSON/fromJSON", () => {
  const { model } = check([{ uri: "a.todl", text:
    `namespace acme {
      concept component { name : string; }
      model prod : acme uses lib { component checkout { name = "C"; } }
    }` }]);
  const restored = fromJSON(toJSON(model));

  const node = restored.resolve("prod");
  assert.ok(node);
  assert.equal(node!.tier, Tier.Instance);
  assert.equal(node!.typeOf, MetaKind.Model);
  assert.equal(node!.attrs.get("meta-model"), "acme");
  assert.equal(node!.attrs.get("uses.0"), "lib");
  assert.equal(node!.attrs.get("namespace"), "acme");
  assert.equal(restored.resolve("checkout")!.attrs.get("namespace"), "acme");
});
```

- [ ] **Step 2: Run the test**

Run: `cd TODL && npx tsx --conditions=development --test src/emit/tests/model-roundtrip.test.ts`
Expected: PASS immediately (emit already serializes `attrs`). If it fails, emit no longer round-trips attrs — investigate `toJSON`/`fromJSON` before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/emit/tests/model-roundtrip.test.ts
git commit -m "test(emit): model node + namespace provenance round-trip"
```

---

## Task 8: Migration, version bump, and full green suite

**Files:**
- Modify: `package.json` (version 0.3.1 → 0.4.0)
- Modify (as needed): existing fixtures that used `model … : …` as a generic record — `src/parse/tests/parser.test.ts` (~lines 127, 140), `src/parse/tests/loader.test.ts` (~line 101), and any test asserting the old `binds`/instance shape for a `model` record. Update expectations to the `ModelDecl` shape / model-node graph shape.

**Interfaces:**
- Consumes everything from Tasks 1–7.

- [ ] **Step 1: Run the full suite to find breakage**

Run: `cd TODL && npm test`
Expected: FAIL in fixtures that parsed `model m : ea { … }` as an `InstanceDecl` (now a `ModelDecl`) or that asserted a top-level object without a model (now an `instance.orphan`). Record each failure.

- [ ] **Step 2: Migrate the broken fixtures**

For each failing test, apply the minimal update:
- A parser test asserting `model m : ea { … }` produced a `DeclKind.Instance` with `binds` → update to assert `DeclKind.Model` with `metaModel`, `libraries`, `instances` (see Task 1's assertions for the exact shape).
- A loader test asserting the contained records were top-level instances → they are now `Contains`-children of the model node; assert via `model.related("<model-id>", EdgeKind.Contains, Direction.Out)`.
- A test that declared a bare top-level object purely as an instance fixture and now trips `instance.orphan` → wrap the object(s) in a `model <id> : <namespace> { … }` whose meta-model is the fixture's own namespace, OR filter the expected diagnostics to ignore `instance.orphan` if the test's intent is unrelated. Prefer wrapping.
- A `concept model { … }` declaration (name in identifier position) still parses unchanged — only a *top-level record whose leading token is `model`* changes meaning. Confirm each such fixture; leave genuinely-unaffected ones alone.

Do not weaken assertions beyond what the new semantics require.

- [ ] **Step 3: Bump the version**

In `package.json`, set:

```json
  "version": "0.4.0",
```

- [ ] **Step 4: Run the full suite to verify green**

Run: `cd TODL && npm test`
Expected: PASS — all suites green, including the five new test files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(todl): migrate model fixtures; bump to 0.4.0"
```

---

## Self-Review Notes (author)

- **Spec coverage:** §3 surface → Task 1; §4 AST/parser → Task 1; §5 graph/data model → Tasks 2–3; §6 provenance → Tasks 2–3 + Task 7 round-trip; §7 three diagnostics → Tasks 4 (orphan), 5 (binding), 6 (scope) incl. graceful degradation; §9 emit → Task 7 (no code change, guarded by test); §10 migration/version → Task 8; §11 testing → per-task tests + Task 8 suite; §12 sequencing → Tasks 1–4 (layer 1) then 5–7 (layer 2), 8 closeout.
- **Type consistency:** `ModelDecl` fields (`metaModel`, `libraries`, `instances`, `metaModelSpan`, `librarySpans`) are identical across Tasks 1, 3, 8. Attr keys `meta-model`, `uses.count`, `uses.<i>`, `namespace` are identical across Tasks 3, 5, 6, 7. `boundModules` (Task 5) is reused verbatim by Task 6. `setNamespace`/`assertModel` (Task 2) are consumed exactly as declared by Task 3.
- **Publish step** (Verdaccio republish + Plexus bump) is intentionally out of this plan — it is a release action, taken after the branch merges, not a code task.
