# Inline Object Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a TODL field be assigned a typed anonymous object literal — `field = concept { … }` (and lists) — materialized as an addressable node with an id from an injectable id generator (snowflake by default), round-tripping in inline form.

**Architecture:** A new `ValueKind.Object` AST node parsed by reusing the record-body loop. The loader routes each inline object through the existing `applyInstance` machinery (giving it assignments, nested records, and edge-record children for free), then binds it to the explicitly-named field. Ids come from an `IdGenerator` seam threaded from `load`; the `.todl` emitter re-emits field-bound contained children inline with their id.

**Tech Stack:** TypeScript (ESM, strict). Tests: node:test + node:assert/strict via `tsx`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises.
- Test command REQUIRES `--test-force-exit`: `npx tsx --conditions=development --test --test-force-exit "src/<path>/tests/<file>.test.ts"`.
- Build: `npm run build`. Publish (Task 6): `npm publish --registry http://localhost:4873` — local Verdaccio ONLY, never public npm.
- Numeric literals lex as `Name`/`Number` and store as strings (TODL has no Number value kind) — irrelevant to ids, which are identifier-safe strings.
- Parser stays pure/deterministic — **no id generation in the parser**; ids are minted at load.
- **v1 deferral:** an `annotate` inside an inline object parses but is not staged by the loader (documented; annotations on the owning record are unaffected).
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Work is on branch `feat/inline-objects` (already created off `main`, spec committed).

---

## File Structure

- `src/model/id-generator.ts` — `IdGenerator`, `SnowflakeIdGenerator` (new).
- `src/model/tests/id-generator.ts` — `FakeIdGenerator` test double (new, non-`.test` helper) + tests.
- `src/parse/ast.ts` — `ValueKind.Object`, `ObjectValue`.
- `src/parse/parser.ts` — extract `parseRecordBody`; `parseValue` inline-object branch.
- `src/parse/loader.ts` — thread `IdGenerator`+`asserted` to `realizeValue`; `ObjectValue` case; validation.
- `src/api.ts` — `check`/`checkAgainst` forward the optional `IdGenerator`.
- `src/diagnostics/diagnostic.ts` — `InlineObjectTarget`, `InlineObjectType`.
- `src/emit/todl.ts` — emit field-bound contained children as inline objects.

---

## Task 1: IdGenerator abstraction

**Files:**
- Create: `src/model/id-generator.ts`
- Create: `src/model/tests/id-generator.ts` (FakeIdGenerator + tests)

**Interfaces:**
- Produces: `interface IdGenerator { next(): string }`; `class SnowflakeIdGenerator implements IdGenerator`; `class FakeIdGenerator implements IdGenerator` (test double). Later tasks inject these.

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/id-generator.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { SnowflakeIdGenerator, type IdGenerator } from "../id-generator.js";

/** Deterministic id source for reproducible loader/emitter tests. */
export class FakeIdGenerator implements IdGenerator {
  private n = 0;
  next(): string { return `id-${this.n++}`; }
}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

test("snowflake ids are unique, monotonic, and identifier-safe", () => {
  const gen = new SnowflakeIdGenerator();
  const ids: string[] = [];
  for (let i = 0; i < 2000; i++) ids.push(gen.next());
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const id of ids) assert.ok(ID_RE.test(id), `identifier-safe: ${id}`);
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, "ids must be monotonically increasing");
});

test("FakeIdGenerator is deterministic", () => {
  const gen = new FakeIdGenerator();
  assert.deepEqual([gen.next(), gen.next(), gen.next()], ["id-0", "id-1", "id-2"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/model/tests/id-generator.ts"`
Expected: FAIL — `../id-generator.js` does not exist.

- [ ] **Step 3: Implement the generator**

Create `src/model/id-generator.ts`:

```ts
/** A seam for minting node ids. Injected at load so the parser stays pure. */
export interface IdGenerator {
  next(): string;
}

/**
 * Snowflake-like ids: `o` + base36(timestamp ms) + base36(sequence, 3-wide).
 * Unique and monotonically increasing within a run; identifier-safe (leading
 * letter) so an id is a legal node id. Not reproducible across runs — stability
 * comes from persisting the id (the emitter writes it back), not from the
 * generator. Tests inject a deterministic FakeIdGenerator instead.
 */
export class SnowflakeIdGenerator implements IdGenerator {
  private lastMs = 0;
  private seq = 0;

  next(): string {
    let ms = Date.now();
    if (ms <= this.lastMs) { this.seq += 1; ms = this.lastMs; }
    else { this.lastMs = ms; this.seq = 0; }
    return `o${ms.toString(36)}${this.seq.toString(36).padStart(3, "0")}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit "src/model/tests/id-generator.ts"`
Expected: PASS (2/2).

> Note: the monotonic assertion holds because every id in a single run shares the same base36 timestamp width, so lexicographic order matches issue order.

- [ ] **Step 5: Commit**

```bash
git add src/model/id-generator.ts src/model/tests/id-generator.ts
git commit -m "feat(todl): IdGenerator seam + SnowflakeIdGenerator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: AST + parser — inline object value

**Files:**
- Modify: `src/parse/ast.ts` (`ValueKind`, `ObjectValue`, `ValueNode`)
- Modify: `src/parse/parser.ts` (extract `parseRecordBody`; `parseValue` branch)
- Test: `src/parse/tests/inline-object-parse.test.ts`

**Interfaces:**
- Consumes: existing `parseInstanceFrom`, `parseEdgeRecord`, `parseAnnotationApplication`, `parseApplicationConnectors`, `parseDottedPath`, `parseValue`.
- Produces: `ObjectValue { kind: ValueKind.Object; concept: string; assignments: AssignmentNode[]; children: InstanceDecl[]; annotations: AnnotationApplication[]; conceptSpan?: SourceSpan; span: SourceSpan }`. Task 3 consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/inline-object-parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, ValueKind, type ModelDecl, type ObjectValue } from "../ast.js";

function firstInstanceAssignments(text: string) {
  const model = parse(text).namespace.declarations.find((d) => d.kind === DeclKind.Model) as ModelDecl;
  return model.instances[0].assignments;
}

test("a typed inline object parses as an Object value", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { component c1 {
    primary = slot { environment = prod; };
  } } }`);
  const v = a[0].value as ObjectValue;
  assert.equal(v.kind, ValueKind.Object);
  assert.equal(v.concept, "slot");
  assert.equal(v.assignments[0].name, "environment");
});

test("a list of inline objects parses, with an id assignment", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { component c1 {
    slots = [ slot { environment = prod; }, slot { id = o7f3a9c1; environment = dev; } ];
  } } }`);
  assert.equal(a[0].value.kind, ValueKind.List);
  const items = (a[0].value as { items: ObjectValue[] }).items;
  assert.equal(items[1].concept, "slot");
  assert.equal(items[1].assignments.find((x) => x.name === "id")?.value.kind, ValueKind.Name);
});

test("a bare name value still parses as a Name (no false object match)", () => {
  const a = firstInstanceAssignments(`namespace t { model M : t { component c1 {
    realised_by = microsoft_tech.m365_copilot;
  } } }`);
  assert.equal(a[0].value.kind, ValueKind.Name);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/inline-object-parse.test.ts"`
Expected: FAIL — `ValueKind.Object` undefined / inline object parsed as an error.

- [ ] **Step 3: Extend the AST**

In `src/parse/ast.ts`, add `Object` to `ValueKind` and the `ObjectValue` interface, and extend the union:

```ts
export enum ValueKind {
  String,
  Name,
  List,
  Composite,
  Boolean,
  Object,
}
```

```ts
/** A typed inline object literal — `concept { … }` — assignable to a
 * concept/taxonomy-typed field. Materialised by the loader as a contained,
 * field-bound node with a minted (or `id =`-supplied) id. */
export interface ObjectValue {
  kind: ValueKind.Object;
  concept: string;
  assignments: AssignmentNode[];
  children: InstanceDecl[];
  annotations: AnnotationApplication[];
  conceptSpan?: SourceSpan;
  span: SourceSpan;
}

export type ValueNode =
  | StringValue
  | NameValue
  | ListValue
  | CompositeValue
  | BooleanValue
  | ObjectValue;
```

- [ ] **Step 4: Extract `parseRecordBody` and add the `parseValue` branch**

In `src/parse/parser.ts`, extract the body loop of `parseInstanceFrom` (currently lines ~215-235, between `expect(LBrace)` and `expect(RBrace)`) into a method, and call it from `parseInstanceFrom`:

```ts
/** Parse a record body (between `{` and `}`, both consumed by the caller):
 * annotate applications, connector blocks, `name = value` assignments, edge
 * records, and nested named records. Shared by instance records and inline
 * objects. */
private parseRecordBody(): {
  assignments: AssignmentNode[];
  children: InstanceDecl[];
  annotations: AnnotationApplication[];
} {
  const assignments: AssignmentNode[] = [];
  const children: InstanceDecl[] = [];
  const annotations: AnnotationApplication[] = [];
  while (!this.check(TokenKind.RBrace)) {
    const memberStart = this.startToken();
    if (this.checkKeyword("annotate")) { annotations.push(this.parseAnnotationApplication(memberStart)); continue; }
    if (this.checkKeyword("connectors")) { children.push(this.parseApplicationConnectors(memberStart)); continue; }
    const first = this.expectIdentifier();
    if (this.match(TokenKind.Equals)) {
      const value = this.parseValue();
      this.expect(TokenKind.Semicolon);
      assignments.push({ name: first, value, span: this.spanFrom(memberStart) });
    } else if (this.edgeRecordAhead()) {
      children.push(this.parseEdgeRecord(first, memberStart));
    } else {
      children.push(this.parseInstanceFrom(first, memberStart));
    }
  }
  return { assignments, children, annotations };
}
```

Replace the inlined loop in `parseInstanceFrom` with:

```ts
    this.expect(TokenKind.LBrace);
    const { assignments, children, annotations } = this.parseRecordBody();
    this.expect(TokenKind.RBrace);
```

(keeping the surrounding `instanceOf`/`binds`/`decl` code unchanged).

Add the inline-object recognizer + parser, and branch in `parseValue`. At the **top** of `parseValue` (before the string/number/list checks), add:

```ts
    if (this.check(TokenKind.Identifier) && this.objectAhead()) {
      return this.parseInlineObject(this.startToken());
    }
```

Add the helpers:

```ts
/** True when the tokens ahead form `Identifier ( . Identifier )* {` — a typed
 * inline object, distinct from a bare name value. */
private objectAhead(): boolean {
  let i = 0;
  if (this.peekKind(i) !== TokenKind.Identifier) return false;
  i += 1;
  while (this.peekKind(i) === TokenKind.Dot && this.peekKind(i + 1) === TokenKind.Identifier) i += 2;
  return this.peekKind(i) === TokenKind.LBrace;
}

private parseInlineObject(start: Token): ObjectValue {
  const cStart = this.current();
  const concept = this.parseDottedPath();
  const conceptSpan = this.spanFrom(cStart);
  this.expect(TokenKind.LBrace);
  const { assignments, children, annotations } = this.parseRecordBody();
  this.expect(TokenKind.RBrace);
  return { kind: ValueKind.Object, concept, assignments, children, annotations, conceptSpan, span: this.spanFrom(start) };
}
```

Add `ObjectValue` to the `./ast.js` type import at the top of `parser.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/inline-object-parse.test.ts"`
Expected: PASS (3/3).

- [ ] **Step 6: Run the full parse suite (no regressions)**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/*.test.ts"`
Expected: all green — `parseRecordBody` extraction preserves instance parsing.

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/inline-object-parse.test.ts
git commit -m "feat(todl): parse typed inline object values

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Loader — thread IdGenerator + materialize inline objects

**Files:**
- Modify: `src/parse/loader.ts` (`load`, `loadInto`, instance pass, `applyInstance`, `realizeValue`)
- Modify: `src/api.ts` (`check`, `checkAgainst`)
- Test: `src/parse/tests/inline-object-load.test.ts`

**Interfaces:**
- Consumes: `ObjectValue` (Task 2), `IdGenerator`/`SnowflakeIdGenerator`/`FakeIdGenerator` (Task 1), existing `applyInstance`, `builder.assertInstance/addContains/addRelationship/setField`.
- Produces: `load(sources, idGenerator?)`, `loadInto(model, sources, reserved?, idGenerator?)`, `check(sources, idGenerator?)`, `checkAgainst(bases, sources, idGenerator?)`. `realizeValue(..., asserted, idGen)` and `applyInstance(..., idGen)` gain params.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/inline-object-load.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/id-generator.js";
import { EdgeKind, Direction } from "../../model/graph.js";

const MM = `namespace t {
  concept slot { environment : identifier; }
  concept component { slots : slot[]; primary : slot?; }
}`;

function loadModel(body: string, gen = new FakeIdGenerator()) {
  return load([{ uri: "t.todl", text: `${MM}\n${body}` }], gen);
}

test("a minted inline object is a contained, field-bound node", () => {
  const { model, diagnostics } = loadModel(
    `namespace t { model M : t { component c1 { primary = slot { environment = prod; }; } } }`,
  );
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  // Fake generator → first minted id is "id-0".
  assert.ok(model.resolve("id-0"), "inline node id-0 exists");
  assert.equal(model.resolve("id-0")?.attrs.get("environment"), "prod");
  // Contained by c1 and bound to the `primary` field.
  assert.ok(model.related("c1", EdgeKind.Contains, Direction.Out).includes("id-0"));
  assert.deepEqual(model.refs("c1", "primary"), ["id-0"]);
});

test("an author-supplied id is reused (not minted)", () => {
  const { model } = loadModel(
    `namespace t { model M : t { component c1 { primary = slot { id = keep_me; environment = dev; }; } } }`,
  );
  assert.ok(model.resolve("keep_me"), "author id reused");
  assert.deepEqual(model.refs("c1", "primary"), ["keep_me"]);
});

test("a list of inline objects binds each, in order", () => {
  const { model } = loadModel(
    `namespace t { model M : t { component c1 { slots = [ slot { environment = a; }, slot { environment = b; } ]; } } }`,
  );
  assert.deepEqual(model.refs("c1", "slots"), ["id-0", "id-1"]);
  assert.equal(model.resolve("id-1")?.attrs.get("environment"), "b");
});
```

> Note: match the `severity`/`EdgeKind`/`Direction`/`refs`/`related` conventions to the codebase — see `src/parse/tests/loader-model.test.ts`. If `severity` is enum-valued, import `Severity` and compare `d.severity === Severity.Error`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/inline-object-load.test.ts"`
Expected: FAIL — `load` takes no generator arg / `ObjectValue` unhandled in `realizeValue`.

- [ ] **Step 3: Thread the generator through `load`/`loadInto`/`check`**

In `src/parse/loader.ts`, import the generator and add the param (default snowflake), threading it to the instance pass:

```ts
import { type IdGenerator, SnowflakeIdGenerator } from "../model/id-generator.js";

export function load(sources: SourceFile[], idGenerator: IdGenerator = new SnowflakeIdGenerator()): LoadResult {
  const model = new Repository();
  const diagnostics = loadInto(model, sources, new Set(), idGenerator);
  return { model, diagnostics };
}

export function loadInto(
  model: Repository,
  sources: SourceFile[],
  reserved: ReadonlySet<string> = new Set(),
  idGenerator: IdGenerator = new SnowflakeIdGenerator(),
): Diagnostic[] {
```

In the instance pass (Pass 2b, the `third` builder loop), pass `idGenerator` into `applyInstance`/`applyModel`, and into the `deferredCompositions` / `deferredTermValues` calls to `applyInstance`/`realizeValue`.

In `src/api.ts`:

```ts
export function check(sources: SourceFile[], idGenerator?: IdGenerator): { model: Repository; diagnostics: Diagnostic[] } {
  return checkAgainst([], sources, idGenerator);
}
export function checkAgainst(
  bases: TodlDocument[],
  sources: SourceFile[],
  idGenerator: IdGenerator = new SnowflakeIdGenerator(),
): { model: Repository; diagnostics: Diagnostic[] } {
  const model = new Repository(mergeBases([preludeDocument(), ...bases]));
  const diagnostics = loadInto(model, sources, preludeNames(), idGenerator);
  return { model, diagnostics: [...diagnostics, ...validate(model)] };
}
```

Add `import { type IdGenerator, SnowflakeIdGenerator } from "./model/id-generator.js";` to `api.ts`.

- [ ] **Step 4: Add `idGen` to `applyInstance` + `realizeValue`, and the `ObjectValue` case**

Give `applyInstance` and `realizeValue` the generator (and give `realizeValue` the `asserted` set so it can materialize object children via `applyInstance`). Update every call site (`applyInstance`'s own assignment loop + child recursion; the Pass 2b `deferredTermValues` loop; `stageApplications`'s `realizeValue` call — pass the ambient `asserted` where available, or a fresh `new Set()` for the annotation path where object values never occur).

`applyInstance` signature + assignment/child calls:

```ts
function applyInstance(
  builder: Builder, model: Repository, decl: InstanceDecl,
  parent: string | null, parentConcept: string | null,
  asserted: Set<string>, diagnostics: Diagnostic[], idGen: IdGenerator,
): void {
  // … unchanged head …
  for (const assignment of decl.assignments) {
    realizeValue(builder, model, decl.concept, decl.id, assignment.name, assignment.value, diagnostics, asserted, idGen);
  }
  for (const child of decl.children) {
    applyInstance(builder, model, child, decl.id, decl.concept, asserted, diagnostics, idGen);
  }
}
```

`realizeValue` signature + the new case (add to the `switch (value.kind)`):

```ts
function realizeValue(
  builder: Builder, model: Repository, concept: string, id: string,
  name: string, value: ValueNode, diagnostics: Diagnostic[],
  asserted: Set<string>, idGen: IdGenerator,
): void {
  const reference = isReferenceMember(model, concept, name);
  // … existing mismatch helper + String/Boolean/Name/List/Composite cases,
  //    passing `asserted, idGen` through the List recursion …
  switch (value.kind) {
    // …
    case ValueKind.Object: {
      // Validation (Task 4) runs here first.
      const idAssign = value.assignments.find((a) => a.name === "id");
      const objId = idAssign !== undefined ? nameOfValue(idAssign.value) : idGen.next();
      const synth: InstanceDecl = {
        kind: DeclKind.Instance, concept: value.concept, id: objId,
        binds: null, isClass: false, instanceOf: null,
        assignments: value.assignments.filter((a) => a.name !== "id"),
        children: value.children, annotations: [], span: value.span,
      };
      applyInstance(builder, model, synth, null, null, asserted, diagnostics, idGen);
      builder.addContains(id, objId);
      builder.addRelationship(id, name, objId);
      break;
    }
  }
}

/** The bare string of a name/string value — used to read an inline object's `id =`. */
function nameOfValue(v: ValueNode): string {
  if (v.kind === ValueKind.Name) return v.name;
  if (v.kind === ValueKind.String) return v.text;
  return String((v as { name?: string }).name ?? "");
}
```

(`synth.annotations` is `[]` — inline-object annotations are the documented v1 deferral. Import `DeclKind` in `loader.ts` if not already imported.)

Update the List case to thread `asserted, idGen` into its per-item `realizeValue` recursion, and the `deferredTermValues` loop + `stageApplications` to pass them.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/inline-object-load.test.ts"`
Expected: PASS (3/3).

- [ ] **Step 6: Run the full parse suite (no regressions)**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/*.test.ts"`
Expected: all green — existing corpora have no inline objects, so the new case never fires; signature threading is mechanical.

- [ ] **Step 7: Commit**

```bash
git add src/parse/loader.ts src/api.ts src/parse/tests/inline-object-load.test.ts
git commit -m "feat(todl): materialize inline objects as field-bound nodes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Validation — target + type diagnostics

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (two codes)
- Modify: `src/parse/loader.ts` (`realizeValue` `ObjectValue` case: validate before materializing)
- Test: `src/parse/tests/inline-object-validate.test.ts`

**Interfaces:**
- Consumes: `realizeValue` `ObjectValue` case (Task 3), `model.effectiveSchema`, `model.supertypesOf`.
- Produces: `DiagnosticCode.InlineObjectTarget`, `DiagnosticCode.InlineObjectType`.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/inline-object-validate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/id-generator.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const MM = `namespace t {
  concept slot { environment : identifier; }
  concept fancy_slot : slot {}
  concept component { slots : slot[]; label : identifier; }
}`;

function codes(body: string) {
  return load([{ uri: "t.todl", text: `${MM}\n${body}` }], new FakeIdGenerator())
    .diagnostics.map((d) => d.code);
}

test("inline object on a primitive field is a target error", () => {
  const cs = codes(`namespace t { model M : t { component c1 { label = slot { environment = x; }; } } }`);
  assert.ok(cs.includes(DiagnosticCode.InlineObjectTarget));
});

test("inline object whose concept mismatches the field type is a type error", () => {
  const cs = codes(`namespace t { model M : t { component c1 { slots = [ component { } ]; } } }`);
  assert.ok(cs.includes(DiagnosticCode.InlineObjectType));
});

test("a subtype of the field type is accepted", () => {
  const cs = codes(`namespace t { model M : t { component c1 { slots = [ fancy_slot { environment = x; } ]; } } }`);
  assert.ok(!cs.includes(DiagnosticCode.InlineObjectType) && !cs.includes(DiagnosticCode.InlineObjectTarget));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/inline-object-validate.test.ts"`
Expected: FAIL — `DiagnosticCode.InlineObjectTarget`/`InlineObjectType` undefined.

- [ ] **Step 3: Add the diagnostic codes**

In `src/diagnostics/diagnostic.ts`, in the `DiagnosticCode` enum (near the value-kind codes):

```ts
  InlineObjectTarget = "inline-object.target",
  InlineObjectType = "inline-object.type",
```

- [ ] **Step 4: Validate in the `ObjectValue` case**

At the top of the `ObjectValue` case in `realizeValue` (before minting/materializing), add:

```ts
      const fieldType = referenceMemberType(model, concept, name);
      if (fieldType === undefined) {
        diagnostics.push({
          code: DiagnosticCode.InlineObjectTarget, severity: Severity.Error,
          message: `"${concept}.${name}" is not a concept-typed member — an inline object cannot be assigned to it`,
          span: value.span, node: id, path: `${concept}.${name}`,
        });
        return;
      }
      if (value.concept !== fieldType && !model.supertypesOf(value.concept).includes(fieldType)) {
        diagnostics.push({
          code: DiagnosticCode.InlineObjectType, severity: Severity.Error,
          message: `inline object of concept "${value.concept}" is not assignable to "${concept}.${name}" (expects "${fieldType}" or a subtype)`,
          span: value.span, node: id, path: `${concept}.${name}`,
        });
        return;
      }
```

Add the helper (near `isReferenceMember` at the file's end):

```ts
/** The declared concept type a reference member targets (field type or a single
 * relationship target), or undefined when `name` is not a concept-typed member. */
function referenceMemberType(model: Repository, concept: string, name: string): string | undefined {
  const schema = model.effectiveSchema(concept);
  const field = schema.fields.find((f) => f.name === name);
  if (field !== undefined) return isReferenceType(model, field.type) ? field.type : undefined;
  const rel = schema.relationships.find((r) => r.name === name);
  return rel?.targets[0];
}
```

(`isReferenceType` is already defined in `loader.ts` — see `__test__` export.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit "src/parse/tests/inline-object-validate.test.ts"`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/parse/loader.ts src/parse/tests/inline-object-validate.test.ts
git commit -m "feat(todl): validate inline object target + concept type

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Emitter — inline round-trip

**Files:**
- Modify: `src/emit/todl.ts` (`emitModelTodl`, `emitOne`)
- Test: `src/emit/tests/inline-object-roundtrip.test.ts`

**Interfaces:**
- Consumes: `toJSON` (a compiled model → `TodlDocument`), `emitModelTodl`, the `Contains` + `Relationship` edges the loader wrote.
- Produces: inline emission of field-bound contained children.

- [ ] **Step 1: Write the failing test**

Create `src/emit/tests/inline-object-roundtrip.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../../parse/loader.js";
import { FakeIdGenerator } from "../../model/tests/id-generator.js";
import { toJSON } from "../json.js";
import { emitModelTodl, deriveBindings } from "../todl.js";

const MM = `namespace t {
  concept slot { environment : identifier; }
  concept component { slots : slot[]; }
}`;

function emit(body: string): string {
  const { model } = load([{ uri: "t.todl", text: `${MM}\n${body}` }], new FakeIdGenerator());
  const own = toJSON(model); // NOTE: filter to own delta per the repo's emit helper if required
  const bindings = deriveBindings(model, new Set(), "t", own);
  return emitModelTodl(own, "t", bindings);
}

test("a field-bound inline object round-trips inline with its id", () => {
  const out = emit(`namespace t { model M : t { component c1 { slots = [ slot { environment = prod; } ]; } } }`);
  // Inline form, NOT a flattened top-level `slot id-0 { }` + reference.
  assert.match(out, /slots\s*=\s*slot\s*\{/);
  assert.match(out, /id\s*=\s*id-0/);
  assert.doesNotMatch(out, /^\s*slot id-0 \{/m);
});
```

> Note: mirror the exact `toJSON`→own-delta plumbing used by the existing emitter tests (`src/emit/tests/boolean-roundtrip.test.ts` / `annotation-roundtrip.test.ts`) — they show how the own delta is obtained and how `deriveBindings`/`emitModelTodl` are driven. Match that setup rather than the sketch above if it differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/emit/tests/inline-object-roundtrip.test.ts"`
Expected: FAIL — the flat emitter emits `slots = id-0;` plus a separate top-level `slot id-0 { … }`.

- [ ] **Step 3: Emit field-bound contained children inline**

In `src/emit/todl.ts`, build a containment + field-binding map and emit those children inline (recursively), excluding them from the top-level list. Replace the concrete-node loop + `emitOne` with a version that receives the maps:

```ts
// In emitModelTodl, after building `rels`, also index containment:
const containedBy = new Map<string, string>();   // child -> parent
for (const e of own.edges) if (e.kind === "Contains") containedBy.set(String(e.to), String(e.from));
const byId = new Map(instances.map((n) => [n.id, n] as const));

// A child is INLINE when it is contained by its parent AND the parent has a
// field-relationship pointing to it. Such children are emitted inside the
// parent, and skipped at top level.
const inlineChildren = new Set<string>();
for (const [from, list] of rels) {
  for (const r of list) {
    if (containedBy.get(r.to) === from && byId.has(r.to)) inlineChildren.add(r.to);
  }
}

// Top-level = concrete nodes that are not inline children.
for (const n of concrete.filter((n) => !inlineChildren.has(n.id))) {
  for (const l of emitOne(n, instanceOf.get(n.id), rels.get(n.id) ?? [], { byId, rels, inlineChildren, instanceOf })) {
    lines.push(`  ${l}`);
  }
}
```

Extend `emitOne` to take a context and, for each field-relationship whose targets are inline children, emit `field = concept { … }` (single) or `field = [ concept { … }, … ]` (list) instead of `field = <id>;`, recursing into the child's own body (its scalar attrs incl. `id`, and its own inline children). A plain (non-inline) relationship target still emits as a bare/dotted name as today. Emit the child's `id` as `id = <id>;` (do NOT skip it via `MARKER_ATTRS` for inline children — it must round-trip).

> Implementation detail for the recursion: factor the body-building (attrs + member lines) of `emitOne` so it can render an inline child's `{ … }` block with the same rules, indented one level deeper.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit "src/emit/tests/inline-object-roundtrip.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run the full emit suite (no regressions)**

Run: `npx tsx --conditions=development --test --test-force-exit "src/emit/tests/*.test.ts"`
Expected: all green. If a prior test asserted the *flattened* emission of a field-bound nested record, update it to the new inline form (this is the intended normalization from the spec §6) and note it in the commit.

- [ ] **Step 6: Commit**

```bash
git add src/emit/todl.ts src/emit/tests/inline-object-roundtrip.test.ts
git commit -m "feat(todl): emit field-bound contained children as inline objects

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Build, version, publish 0.27.0

**Files:**
- Modify: `package.json` (version → `0.27.0`)

**Interfaces:**
- Consumes: Tasks 1-5 committed.
- Produces: `@pragmatic-lab/todl@0.27.0` on local Verdaccio.

- [ ] **Step 1: Run the full TODL suite**

Run: `npx tsx --conditions=development --test --test-force-exit "src/**/*.test.ts"`
Expected: all green (prior baseline 540 + the new inline-object tests).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean tsc build.

- [ ] **Step 3: Bump + publish**

Set `"version": "0.27.0"` in `package.json`, then:

Run: `npm publish --registry http://localhost:4873`
Expected: `+ @pragmatic-lab/todl@0.27.0`. (Verify Verdaccio, never public npm.)

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(todl): release 0.27.0 (inline object construction)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 IdGenerator → Task 1 (seam + snowflake + fake). ✓
- §2 Grammar/AST (`ValueKind.Object`, `id =` assignment) → Task 2. ✓
- §3 Parser (`parseValue` branch, `parseRecordBody` reuse, pure) → Task 2. ✓
- §4 Loader/materialisation (thread generator, contained + field-bound, list order, addressable node) → Task 3. ✓
- §5 Validation (target + subtype) → Task 4. ✓
- §6 Round-trip (inline emission with `id =`, normalization) → Task 5. ✓
- §7 Testing rows → Tasks 1-5 tests. ✓
- Release → Task 6. ✓

**Placeholder scan:** No TBD/TODO. The two `> Note` callouts point the implementer to existing tests to match conventions (severity comparison, emit plumbing) — grounded instructions, not placeholders.

**Type consistency:** `IdGenerator.next(): string` used identically across Tasks 1/3. `realizeValue(..., asserted, idGen)` and `applyInstance(..., idGen)` signatures defined in Task 3 and depended on nowhere earlier. `ObjectValue` fields defined in Task 2, consumed in Tasks 3-5. `referenceMemberType`/`nameOfValue` are new helpers local to `loader.ts`. `DiagnosticCode.InlineObjectTarget/Type` defined in Task 4, used only there.

**Ambiguity resolved:** annotation-inside-inline deferral stated in Global Constraints + Task 3 (`synth.annotations = []`). Emitter normalization of named field-bound records disclosed in Task 5 Step 5. `severity` enum-vs-string comparison flagged with a reference test in Tasks 3-4.
