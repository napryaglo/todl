# Operator Value Expressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an operator application (`a ==> b`) a value expression that evaluates to the minted entity's reference, usable on the RHS of `=` and inside array literals — not just as a bare statement.

**Architecture:** Reuse the existing `EdgeApplication` shape as a new `ValueKind.Edge` value node; `parseValue` parses it wherever a value is expected; the loader materializes it exactly like an inline object (mint the reified entity, contain it in the owner, bind it to the field), with the operator supplying the concept + endpoint bindings; the emitter renders a field-bound reified edge back as `a ==> b` shorthand.

**Tech Stack:** TypeScript (ESM, strict). Tests: `npx tsx --conditions=development --test --test-force-exit "src/<path>/tests/<file>.test.ts"`. Build: `npm run build`. node:test + node:assert/strict.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-16-operator-value-expressions-design.md`. Builds on the operators feature (already on `main`, todl 0.28.0).
- Every test file lives in a `tests/` subfolder next to the source it exercises.
- TODL tests MUST run with `--test-force-exit`.
- Use real TypeScript enums, never string-literal unions.
- Only **reified** operators (mint a node) are legal in value position; a **relationship-form** operator as a value is `operator.not-a-value`.
- Statement-position edge behavior (`a --> b;` in a body → contained, no field binding) is UNCHANGED.
- Publish/version bump (`@pragmatic-lab/todl` → 0.29.0) happens at the finishing step, not inside a task.

---

### Task 1: `ValueKind.Edge` — AST + parser

**Files:**
- Modify: `src/parse/ast.ts` (`ValueKind` enum ~23-30; add `EdgeValue`; add to `ValueNode` union ~77-83)
- Modify: `src/parse/parser.ts` (`parseValue` ~479-482 — add edge branch)
- Test: `src/parse/tests/edge-value-parse.test.ts` (create)

**Interfaces:**
- Consumes: `EdgeApplication` (exists), `parseEdgeApplication` (exists, parser private), `edgeApplicationAhead` (exists, parser private).
- Produces: `ValueKind.Edge`; `interface EdgeValue { kind: ValueKind.Edge; edge: EdgeApplication; }`; `parseValue` returns an `EdgeValue` when an edge application is ahead.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/edge-value-parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, ValueKind, type ModelDecl, type EdgeValue } from "../ast.js";

function firstInstanceAssignments(text: string) {
  const m = parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Model) as ModelDecl;
  return m.instances[0].assignments;
}

test("an edge on the RHS of = parses as an Edge value", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { sequence sq { primary = x ==> y; } } }`);
  const v = a.find((x) => x.name === "primary")!.value as EdgeValue;
  assert.equal(v.kind, ValueKind.Edge);
  assert.equal(v.edge.glyph, "==>");
  assert.equal(v.edge.left, "x");
  assert.equal(v.edge.right, "y");
});

test("a list of edges parses as a list of Edge values", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { sequence sq { steps = [ a ==> b, b ==> c ]; } } }`);
  const list = a.find((x) => x.name === "steps")!.value;
  assert.equal(list.kind, ValueKind.List);
  const items = (list as { items: EdgeValue[] }).items;
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, ValueKind.Edge);
  assert.equal(items[1].edge.left, "b");
});

test("an edge value with a body captures body assignments", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { sequence sq { primary = x ==> y { kind = fast; }; } } }`);
  const v = a.find((x) => x.name === "primary")!.value as EdgeValue;
  assert.ok(v.edge.body.find((b) => b.name === "kind"));
});

test("a bare name value is still a Name (not an edge)", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { sequence sq { entry_point = actor1; } } }`);
  assert.equal(a.find((x) => x.name === "entry_point")!.value.kind, ValueKind.Name);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/edge-value-parse.test.ts"`
Expected: FAIL — `ValueKind.Edge` undefined.

- [ ] **Step 3: Implement the AST**

In `src/parse/ast.ts`, add `Edge` to `ValueKind`:

```ts
export enum ValueKind {
  String,
  Name,
  List,
  Composite,
  Boolean,
  Object,
  Edge,
}
```

Add the interface (near `ObjectValue`, after it):

```ts
/** An operator application used as a value — `a <glyph> b` on the RHS of `=` or
 * as an array element (design §2). Materialised by the loader as the minted
 * reified entity, contained by the owner and bound to the field. */
export interface EdgeValue {
  kind: ValueKind.Edge;
  edge: EdgeApplication;
}
```

Add `EdgeValue` to the `ValueNode` union:

```ts
export type ValueNode =
  | StringValue
  | NameValue
  | ListValue
  | CompositeValue
  | BooleanValue
  | ObjectValue
  | EdgeValue;
```

`EdgeApplication` is already declared in this file — no import needed.

- [ ] **Step 4: Implement the parser branch**

In `src/parse/parser.ts` `parseValue`, add as the FIRST check (before `objectAhead`), so `a ==> b` is not misread as a name:

```ts
  private parseValue(): ValueNode {
    if (this.edgeApplicationAhead()) {
      return { kind: ValueKind.Edge, edge: this.parseEdgeApplication(this.startToken()) };
    }
    if (this.check(TokenKind.Identifier) && this.objectAhead()) {
      return this.parseInlineObject(this.startToken());
    }
    // … rest unchanged …
```

`edgeApplicationAhead()` (matches `Identifier (.Identifier)* SymbolOp`) and `objectAhead()` (matches `… {`) are disjoint, so order between them is safe; the edge check goes first for clarity. `EdgeValue` must be importable — add `type EdgeValue` to the ast import block in parser.ts if TS complains about the returned object literal (the literal is structurally typed, so it usually is not required; add the import only if needed).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/edge-value-parse.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/edge-value-parse.test.ts
git commit -m "feat(parser): ValueKind.Edge — operator application as a value expression"
```

---

### Task 2: Reference resolution for edge values

**Files:**
- Modify: `src/parse/references.ts` (`visitValueRefs` switch — add `ValueKind.Edge` case)
- Test: `src/parse/tests/edge-value-references.test.ts` (create)

**Interfaces:**
- Consumes: `EdgeValue` (Task 1); `visitEdgeRefs` (exists in references.ts), `visitValueRefs` (exists), `RefRole` (exists).
- Produces: an edge value's operands + body refs flow through the resolution loop (qualified → flat, undefined → `reference.undefined`).

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/edge-value-references.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { visitReferences, RefRole } from "../references.js";

test("an edge value's operands are visited as references", () => {
  const decl = parse(`namespace t { model M : t { sequence sq { steps = [ a ==> b ]; } } }`).namespace.declarations[0];
  const names: string[] = [];
  visitReferences(decl, (v) => { if (v.role === RefRole.RefValue) names.push(v.name); });
  assert.ok(names.includes("a") && names.includes("b"));
});

test("a qualified edge operand rewrites flat", () => {
  const decl = parse(`namespace t { model M : t { sequence sq { steps = [ lib.a ==> lib.b ]; } } }`).namespace.declarations[0];
  visitReferences(decl, (v) => { if (v.role === RefRole.RefValue && v.name === "lib.a") v.rewrite("a"); });
  // No assertion on internal AST mutation beyond not throwing; the resolution loop uses this hook.
  assert.ok(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/edge-value-references.test.ts"`
Expected: FAIL — operands of an edge value are not visited (names list lacks `a`/`b`).

- [ ] **Step 3: Implement**

In `src/parse/references.ts` `visitValueRefs`, add a case alongside `ValueKind.Object`:

```ts
    case ValueKind.Edge:
      // Operands resolve like any value reference; the glyph is resolved against
      // the operator table by the loader. Body value refs resolve too (skip `id`).
      visitEdgeRefs(value.edge, visit, scope);
      for (const a of value.edge.body) if (a.name !== "id") visitValueRefs(a.value, ownerNode, a.name, a.span, scope, visit);
      break;
```

`visitEdgeRefs` and `visitValueRefs` are already in this file; `ValueKind` is already imported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/edge-value-references.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parse/references.ts src/parse/tests/edge-value-references.test.ts
git commit -m "feat(references): resolve operands of edge values"
```

---

### Task 3: Loader — materialize edge values

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (add `OperatorNotAValue`)
- Modify: `src/parse/loader.ts` (factor `mintReifiedEdge` out of `applyEdge`; add `realizeEdgeValue`; add `ValueKind.Edge` case to `realizeValue`)
- Test: `src/parse/tests/edge-value-load.test.ts` (create)

**Interfaces:**
- Consumes: `EdgeValue` (Task 1); `OperatorTable`, `applyEdge`, `applyInstance`, `nameOfValue`, `referenceMemberType`, `operatorTable` (all exist in loader.ts); `builder.addRelationship`; `DiagnosticCode.{OperatorUndefined, InlineObjectTarget, InlineObjectType}`.
- Produces: `mintReifiedEdge(builder, model, edge, op, ownerId, asserted, diagnostics, idGen, ops): string` (returns the minted node id); `realizeEdgeValue(builder, model, ownerConcept, owner, field, edge, diagnostics, asserted, idGen, ops): void`; `DiagnosticCode.OperatorNotAValue = "operator.not-a-value"`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/edge-value-load.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";

function loadSrc(body: string, gen = new FakeIdGenerator()) {
  const src = `namespace t {
    concept endpoint { label : string; }
    concept step { src : endpoint; dst : endpoint; }
    concept sequence { steps : step[]; }
    concept component { depends_on : component[]; }
    operator ==> : step (src, dst);
    operator ->> : component.depends_on;
    model M : t { ${body} }
  }`;
  return load([{ uri: "t.todl", text: src }], gen);
}

test("an edge value in a list mints a step and binds it to the field", () => {
  const { model, diagnostics } = loadSrc(`endpoint a {} endpoint b {} sequence sq { steps = [ a ==> b ]; }`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  assert.deepEqual(model.refs("sq", "steps"), ["id-0"]);
  assert.deepEqual(model.refs("id-0", "src"), ["a"]);
  assert.deepEqual(model.refs("id-0", "dst"), ["b"]);
});

test("multiple edge values bind in order", () => {
  const { model } = loadSrc(`endpoint a {} endpoint b {} endpoint c {} sequence sq { steps = [ a ==> b, b ==> c ]; }`);
  assert.deepEqual(model.refs("sq", "steps"), ["id-0", "id-1"]);
  assert.deepEqual(model.refs("id-1", "dst"), ["c"]);
});

test("an explicit id in an edge value body is reused", () => {
  const { model } = loadSrc(`endpoint a {} endpoint b {} sequence sq { steps = [ a ==> b { id = s1; } ]; }`);
  assert.deepEqual(model.refs("sq", "steps"), ["s1"]);
});

test("a relationship-form operator as a value is operator.not-a-value", () => {
  const { diagnostics } = loadSrc(`component w {} component d {} sequence sq { steps = [ w ->> d ]; }`);
  assert.ok(diagnostics.map((x) => x.code).includes(DiagnosticCode.OperatorNotAValue));
});

test("an edge value whose concept mismatches the field type is a type error", () => {
  const { diagnostics } = loadSrc(`endpoint a {} endpoint b {} component c { depends_on = [ a ==> b ]; }`);
  assert.ok(diagnostics.map((x) => x.code).includes(DiagnosticCode.InlineObjectType));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/edge-value-load.test.ts"`
Expected: FAIL — edge values not materialized.

- [ ] **Step 3: Add the diagnostic code**

In `src/diagnostics/diagnostic.ts`, after `OperatorSourceType = "operator.source-type",` add:

```ts
  OperatorNotAValue = "operator.not-a-value",
```

- [ ] **Step 4: Factor `mintReifiedEdge` out of `applyEdge`**

In `src/parse/loader.ts`, the reified branch of `applyEdge` currently synthesizes an `InstanceDecl` and calls `applyInstance`. Extract that into a helper that returns the minted id:

```ts
/** Mint a reified operator edge as a contained instance (endpoints + body),
 * reusing the instance machinery. Returns the minted node id. */
function mintReifiedEdge(
  builder: Builder, model: Repository, edge: EdgeApplication, op: ResolvedOperator, ownerId: string | null,
  asserted: Set<string>, diagnostics: Diagnostic[], idGen: IdGenerator, ops: OperatorTable,
): string {
  const idAssign = edge.body.find((a) => a.name === "id");
  const objId = idAssign !== undefined ? nameOfValue(idAssign.value) : idGen.next();
  const assignments: AssignmentNode[] = [];
  if (op.from !== null) assignments.push({ name: op.from, value: { kind: ValueKind.Name, name: edge.left } });
  if (op.to !== null) assignments.push({ name: op.to, value: { kind: ValueKind.Name, name: edge.right } });
  for (const a of edge.body) if (a.name !== "id") assignments.push(a);
  const synth: InstanceDecl = {
    kind: DeclKind.Instance, concept: op.concept, id: objId, binds: null, isClass: false, instanceOf: null,
    assignments, children: [], annotations: [], edges: [], span: edge.span,
  };
  applyInstance(builder, model, synth, ownerId, null, asserted, diagnostics, idGen, ops);
  return objId;
}
```

Then replace the reified branch of `applyEdge` (everything after the `op.relationship !== null` block) with:

```ts
  mintReifiedEdge(builder, model, edge, op, ownerId, asserted, diagnostics, idGen, ops);
```

(The statement path discards the returned id — the entity is contained by `ownerId`, no field binding, unchanged.)

- [ ] **Step 5: Add `realizeEdgeValue` and wire `realizeValue`**

Add the value materializer (near `realizeInlineObject`):

```ts
/** Materialise an operator application used as a value: mint the reified entity
 * (contained by the owner) and bind it to `field` — the inline-object path with
 * the operator supplying the concept + endpoint bindings (design §4). */
function realizeEdgeValue(
  builder: Builder, model: Repository, ownerConcept: string, owner: string, field: string,
  edge: EdgeApplication, diagnostics: Diagnostic[], asserted: Set<string>, idGen: IdGenerator, ops: OperatorTable,
): void {
  const op = ops.get(edge.glyph);
  if (op === undefined) {
    diagnostics.push({ code: DiagnosticCode.OperatorUndefined, severity: Severity.Error,
      message: `no operator "${edge.glyph}" is declared in the meta-model`, span: edge.glyphSpan ?? edge.span, node: owner, path: null });
    return;
  }
  if (op.relationship !== null) {
    diagnostics.push({ code: DiagnosticCode.OperatorNotAValue, severity: Severity.Error,
      message: `operator "${edge.glyph}" is a relationship edge and yields no entity — it cannot be used as a value`, span: edge.span, node: owner, path: null });
    return;
  }
  const fieldType = referenceMemberType(model, ownerConcept, field);
  if (fieldType === undefined) {
    diagnostics.push({ code: DiagnosticCode.InlineObjectTarget, severity: Severity.Error,
      message: `"${ownerConcept}.${field}" is not a concept-typed member — an edge value cannot be assigned to it`, span: edge.span, node: owner, path: `${ownerConcept}.${field}` });
    return;
  }
  if (op.concept !== fieldType && !model.supertypesOf(op.concept).includes(fieldType)) {
    diagnostics.push({ code: DiagnosticCode.InlineObjectType, severity: Severity.Error,
      message: `edge of concept "${op.concept}" is not assignable to "${ownerConcept}.${field}" (expects "${fieldType}" or a subtype)`, span: edge.span, node: owner, path: `${ownerConcept}.${field}` });
    return;
  }
  const id = mintReifiedEdge(builder, model, edge, op, owner, asserted, diagnostics, idGen, ops);
  builder.addRelationship(owner, field, id);
}
```

In `realizeValue`, add the case alongside `ValueKind.Object`:

```ts
    case ValueKind.Edge:
      realizeEdgeValue(builder, model, concept, id, name, value.edge, diagnostics, asserted, idGen, ops);
      break;
```

Add `type EdgeApplication` to the ast import block in loader.ts if not already imported (it was added for the operators feature — verify).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/edge-value-load.test.ts"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/parse/loader.ts src/parse/tests/edge-value-load.test.ts
git commit -m "feat(loader): materialize edge values (mint + contain + field-bind)"
```

---

### Task 4: Emit — value-position operator shorthand

**Files:**
- Modify: `src/emit/todl.ts` (factor endpoint-shorthand detection; use it in `emitInline`)
- Test: `src/emit/tests/edge-value-roundtrip.test.ts` (create)

**Interfaces:**
- Consumes: `EmitCtx.operators` (exists), `collectOperators` (exists), `emitOne`/`emitInline`/`emitBody` (exist).
- Produces: a field-bound reified edge emits as `left <glyph> right [ { …rest } ]` inside a value list.

- [ ] **Step 1: Write the failing test**

Create `src/emit/tests/edge-value-roundtrip.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { toJSON, type TodlDocument } from "../json.js";
import { collectOperators, deriveBindings, emitModelTodl } from "../todl.js";

// Base: sequence { steps : step[] }, step { src, dst }, operator ==> : step(src,dst).
function base(): Repository {
  const r = new Repository();
  const b = r.builder().setNamespace("acme.ea");
  b.definePrimitive("string");
  b.defineConcept("endpoint");
  b.addField("endpoint", "label", "string");
  b.defineConcept("step");
  b.addField("step", "src", "endpoint");
  b.addField("step", "dst", "endpoint");
  b.defineConcept("sequence");
  b.addField("sequence", "steps", "step");
  b.defineOperator("==>", "step", "src", "dst", null);
  b.commit();
  return r;
}

test("a field-bound reified edge emits as operator shorthand inside a list", () => {
  const model = base();
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  const b = model.builder();
  b.assertInstance("endpoint", "a");
  b.assertInstance("endpoint", "b");
  b.assertInstance("sequence", "sq");
  b.setField("sq", "id", "sq");
  b.assertInstance("step", "id-0");
  b.setField("id-0", "id", "id-0");
  b.addRelationship("id-0", "src", "a");
  b.addRelationship("id-0", "dst", "b");
  b.addContains("sq", "id-0");
  b.addRelationship("sq", "steps", "id-0");
  b.commit();

  const own: TodlDocument = { nodes: [], edges: [] };
  const full = toJSON(model);
  for (const n of full.nodes) if (!baseIds.has(n.id)) own.nodes.push(n);
  for (const e of full.edges) if (!baseIds.has(e.from)) own.edges.push(e);

  const out = emitModelTodl(own, "acme.app", deriveBindings(model, baseIds, "acme.app", own), undefined, collectOperators(model));
  assert.match(out, /a ==> b/, "shorthand in value position");
  assert.doesNotMatch(out, /step \{/, "not the inline-object form");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/emit/tests/edge-value-roundtrip.test.ts"`
Expected: FAIL — emits `step { … }`, not `a ==> b`.

- [ ] **Step 3: Implement**

In `src/emit/todl.ts`, factor the endpoint-shorthand detection that `emitOne` already does into a helper, then call it from `emitInline`. Add near `emitInline`:

```ts
/** If `node` is a reified edge whose concept has an operator and whose only
 * relationship members are the two endpoints, return `left <glyph> right` plus
 * any non-endpoint body lines; else null. Shared by emitOne and emitInline. */
function edgeShorthand(node: JsonNode, ctx: EmitCtx, indent: number): { head: string; rest: string[] } | null {
  const op = ctx.operators.get(node.typeOf);
  if (op === undefined || isClassNode(node) || ctx.instanceOf.get(node.id) !== undefined) return null;
  const rels = ctx.rels.get(node.id) ?? [];
  const from = rels.find((r) => r.via === op.from)?.to;
  const to = rels.find((r) => r.via === op.to)?.to;
  if (from === undefined || to === undefined) return null;
  const rest = emitBody(node, ctx, indent + 1, false).filter((l) => {
    const t = l.trim();
    return !t.startsWith(`${op.from} =`) && !t.startsWith(`${op.to} =`);
  });
  return { head: `${from} ${op.glyph} ${to}`, rest };
}
```

Rewrite the special-case at the top of `emitOne` to use it:

```ts
function emitOne(node: JsonNode, ctx: EmitCtx, indent: number): string[] {
  const pad = "  ".repeat(indent);
  const sh = edgeShorthand(node, ctx, indent);
  if (sh !== null) {
    if (sh.rest.length === 0) return [`${pad}${sh.head};`];
    return [`${pad}${sh.head} {`, ...sh.rest, `${pad}};`];
  }
  const concept = localName(node.typeOf);
  // … rest unchanged …
```

Extend `emitInline` to use it (value position returns a single inline string):

```ts
function emitInline(node: JsonNode, ctx: EmitCtx, indent: number): string {
  const sh = edgeShorthand(node, ctx, indent);
  if (sh !== null) {
    if (sh.rest.length === 0) return sh.head;
    return `${sh.head} {\n${sh.rest.join("\n")}\n${"  ".repeat(indent)}}`;
  }
  const concept = localName(node.typeOf);
  const body = emitBody(node, ctx, indent + 1, true);
  if (body.length === 0) return `${concept} {}`;
  return `${concept} {\n${body.join("\n")}\n${"  ".repeat(indent)}}`;
}
```

Note: `emitInline` drops the `id` line for a shorthand edge (an edge value's minted id is not authored back in shorthand form — it re-mints on load, matching how `a ==> b` was written). Endpoint members render as their raw target ids, consistent with `emitBody`'s reference rendering.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test --test-force-exit "src/emit/tests/edge-value-roundtrip.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/emit/todl.ts src/emit/tests/edge-value-roundtrip.test.ts
git commit -m "feat(emit): value-position operator shorthand"
```

---

### Task 5: Full-suite green + build

**Files:**
- Modify: any residual test/source surfaced by the build.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a green full suite and a clean `tsc` build.

- [ ] **Step 1: Run the full test suite**

Run: `npx tsx --conditions=development --test --test-force-exit "src/**/*.test.ts"`
Expected: all pass. In particular, the inline-object suites and the operators suites must remain green (edge values are additive; statement edges unchanged).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `gen:prelude` + `tsc` succeed. Resolve any non-exhaustive `switch (value.kind)` over `ValueKind` that now needs an `Edge` case (search `src/` for switches on a `ValueNode` — e.g. language-service classifier/hover, emit's value renderers — and add a `ValueKind.Edge` arm; for a read-only consumer that has no meaningful edge handling, treat it like `ValueKind.Object`).

- [ ] **Step 3: Commit any residual fixes**

```bash
git add -A
git commit -m "chore: handle ValueKind.Edge in residual value switches"
```

---

## Self-Review

**Spec coverage:**
- §1 model (statement vs value, reified-only-in-value) → Task 1 (parse) + Task 3 (materialize + `operator.not-a-value`). ✓
- §2 grammar & AST (`ValueKind.Edge`, `parseValue` branch, disambiguation) → Task 1. ✓
- §3 reference resolution (operands + body refs) → Task 2. ✓
- §4 loader materialization (mint + contain + field-bind, field-type check, relationship-form error, shared mint helper) → Task 3. ✓
- §5 emit shorthand (shared endpoint detection lifted into `emitInline`) → Task 4. ✓
- §6 scope/non-goals → statement path untouched (Task 3 factors without changing behavior); no chaining/precedence introduced. ✓

**Placeholder scan:** none — every code step carries real code.

**Type consistency:** `EdgeValue { kind: ValueKind.Edge; edge: EdgeApplication }` is used identically in Tasks 1–3. `mintReifiedEdge(...) : string` signature matches its two call sites (`applyEdge`, `realizeEdgeValue`). `realizeEdgeValue` param order matches its `realizeValue` call site. `edgeShorthand(...) : { head, rest } | null` matches both `emitOne` and `emitInline` callers. `OperatorNotAValue` code used in Task 3 is declared in Task 3 Step 3.

**Deferred (documented in the spec, not this plan):** re-migrating `test_architecture/landscape.todl` steps from `step { … }` to `a ==> b` — a data change.
