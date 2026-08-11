# Union Relationship Targets (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `concept` relationship declare a `|`-union of target concepts (`relationship from -> actor | block | location | component | application?;`) so union-typed references become symbol-checked reference members.

**Architecture:** `RelationshipDecl.target: string` and `RelationshipSchema.target: NodeId` become `targets: (string|NodeId)[]`; targets are stored as first-class `Targets` graph edges (not a string attr); validation unions each target's is-a allowed-set (match-any). Behavior-preserving cutover first (single target = length-1), then the `|` syntax, then union validation/emit/display.

**Tech Stack:** TypeScript (ESM, strict), TODL compiler. Runner: `tsx --conditions=development --test`. Spec: `docs/superpowers/specs/2026-08-11-union-relationship-targets-design.md`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source.
- Real TypeScript `enum`s, never string-literal unions.
- No git push — local commits only. Branch: `feat/union-relationship-targets`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Run one file: `npx tsx --conditions=development --test --test-force-exit <file>`. Full suite: `npm test`.
- No back-compat shims: readers use only `Targets` edges / `targets`; no fallback to the old `target` attr.

---

### Task 1: Cutover `target` → `targets` with `Targets`-edge storage (behavior-preserving)

One cohesive, behavior-preserving refactor: every layer moves from a single `target` to a `targets` array backed by `Targets` edges, but the parser still accepts only a single target (no `|` yet), so all existing tests keep passing once retargeted to the plural shape.

**Files:**
- Modify: `src/model/graph.ts`, `src/parse/ast.ts`, `src/parse/parser.ts`, `src/parse/references.ts`, `src/parse/loader.ts`, `src/model/builder.ts`, `src/model/model.ts`, `src/validate/validate.ts`, `src/emit/js-module.ts`, `src/language-service/hover.ts`, `src/language-service/schema-context.ts`, `src/language-service/signature-help.ts`
- Tests to update: `src/parse/tests/ast-reference-spans.test.ts`, `src/validate/tests/target-type.test.ts`, `src/language-service/tests/schema-context.test.ts`, `src/model/tests/schema.test.ts`, `src/model/tests/builder.test.ts` (any asserting a single `target`)

**Interfaces produced (consumed by Tasks 2–4):**
- `RelationshipDecl { name; targets: string[]; cardinality; nameSpan?; targetSpans?: SourceSpan[] }`
- `RelationshipSchema { name; targets: NodeId[]; cardinality; inverse }`
- `Builder.addConceptRelationship(concept, name, targets: NodeId[], cardinality?, inverse?)`
- `EdgeKind.Targets` (relationship-node → concept)

- [ ] **Step 1: Add the `Targets` edge kind**

`src/model/graph.ts`, in `enum EdgeKind` (line ~27), add after `HasRelationship`:

```ts
  Targets,        // relationship-schema node -> a target concept node
```

- [ ] **Step 2: AST — pluralize the relationship target**

`src/parse/ast.ts` `RelationshipDecl` (line ~157):

```ts
export interface RelationshipDecl {
  name: string;
  targets: string[];
  cardinality: Cardinality;
  nameSpan?: SourceSpan;
  targetSpans?: SourceSpan[];
}
```

- [ ] **Step 3: Parser — produce a length-1 `targets` (no `|` yet)**

`src/parse/parser.ts` `parseRelationship` (line ~713):

```ts
  private parseRelationship(): RelationshipDecl {
    this.expectKeyword("relationship");
    const nameTok = this.expect(TokenKind.Identifier);
    this.expect(TokenKind.Arrow);
    const targetStart = this.current();
    const targets = [this.parseDottedPath()];
    const targetSpans = [this.spanFrom(targetStart)];
    const cardinality = this.parseCardinality();
    this.expect(TokenKind.Semicolon);
    return {
      name: nameTok.value, targets, cardinality,
      nameSpan: tokenSpan(nameTok, this.uri), targetSpans,
    };
  }
```

- [ ] **Step 4: References — visit each target with its span**

`src/parse/references.ts`, the relationship loop (line ~96). Replace the single-target `visit` with a per-target loop:

```ts
  for (const rel of decl.relationships) {
    rel.targets.forEach((target, i) => {
      visit({
        name: target,
        span: rel.targetSpans?.[i] ?? decl.span,
        role: RefRole.RelationshipTarget,
        ownerNode: decl.name,
        memberPath: rel.name,
        rewrite: (r) => { rel.targets[i] = r; },
      });
    });
  }
```

- [ ] **Step 5: Builder — store targets as `Targets` edges**

`src/model/builder.ts` `addConceptRelationship` (line ~154). Take `targets: NodeId[]`, drop the `"target"` attr, stage one `Targets` edge per target:

```ts
  addConceptRelationship(
    concept: NodeId,
    name: string,
    targets: NodeId[],
    cardinality: Cardinality = Cardinality.Many,
    inverse: string | null = null,
  ): this {
    const memberId = `${concept}.${name}`;
    const attrs = new Map<string, Scalar>([
      ["name", name],
      ["cardinality", cardinality],
    ]);
    if (inverse !== null) attrs.set("inverse", inverse);
    if (this.currentNamespace !== null) attrs.set("namespace", this.currentNamespace);
    this.stagedNodes.push({ id: memberId, tier: Tier.Ontology, typeOf: MetaKind.Relationship, attrs });
    this.stagedEdges.push({ kind: EdgeKind.HasRelationship, via: null, from: concept, to: memberId });
    for (const target of targets) {
      this.stagedEdges.push({ kind: EdgeKind.Targets, via: null, from: memberId, to: target });
    }
    return this;
  }
```

Also update `TermInput.relationships[]` (line ~28) `target: NodeId` → `targets: NodeId[]`, and any staging of term relationships to pass the array + emit `Targets` edges the same way.

- [ ] **Step 6: Loader — pass the array through**

`src/parse/loader.ts` (line ~418):

```ts
    for (const relationship of declaration.relationships) {
      second.addConceptRelationship(
        declaration.name, relationship.name, relationship.targets, relationship.cardinality);
    }
```

- [ ] **Step 7: Schema — pluralize + read from `Targets` edges**

`src/model/model.ts` `RelationshipSchema` (line ~37):

```ts
export interface RelationshipSchema {
  name: string;
  targets: NodeId[];
  cardinality: Cardinality;
  inverse: string | null;
}
```

`effectiveSchema` relationship read (line ~330), replace the `target` attr read:

```ts
      relationships.push({
        name: readString(node.attrs.get("name")),
        targets: this.graph.related(memberId, EdgeKind.Targets, Direction.Out),
        cardinality: readCardinality(node.attrs.get("cardinality")),
        inverse: typeof inverse === "string" ? inverse : null,
      });
```

Confirm `EdgeKind` and `Direction` are already imported in `model.ts` (they are — `effectiveSchema` already calls `graph.related(concept, EdgeKind.HasRelationship, Direction.Out)`).

- [ ] **Step 8: Validation — union allowed-set (works for length-1)**

`src/validate/validate.ts` `checkTargetTypes` (line ~436):

```ts
function checkTargetTypes(
  out: Diagnostic[],
  model: Repository,
  node: Node,
  relationship: RelationshipSchema,
  targets: NodeId[],
): void {
  if (relationship.targets.length === 0) return;
  const allowed = new Set<NodeId>();
  for (const t of relationship.targets) {
    allowed.add(t);
    for (const sub of model.subtypesOf(t)) allowed.add(sub);
  }
  const path = `${node.typeOf}.${relationship.name}`;
  const expected = relationship.targets.join(" | ");
  for (const target of targets) {
    const targetNode = model.resolve(target);
    if (targetNode !== undefined && !allowed.has(targetNode.typeOf)) {
      out.push({
        code: DiagnosticCode.TargetTypeMismatch,
        severity: Severity.Error,
        node: node.id,
        path,
        message: `"${path}" expects ${expected} but "${target}" is a ${targetNode.typeOf}`,
        span: spanFor(model, node.id, relationship.name),
      });
    }
  }
}
```

- [ ] **Step 9: JS emit — emit a `targets` array**

`src/emit/js-module.ts` `relationshipEntries` (line ~121):

```ts
function relationshipEntries(rel: RelationshipSchema): string[] {
  return [`targets: ${jsStr(rel.targets)}`, `cardinality: ${jsStr(relationshipCardinalityText(rel.cardinality))}`];
}
```

(`jsStr` must serialize an array — verify it handles `string[]`; if it only handles scalars, emit `[${rel.targets.map(jsStr).join(", ")}]`.)

- [ ] **Step 10: Language service — display the plural**

- `src/language-service/hover.ts` (line ~24): `` lines.push(`- \`${r.name}\` → ${r.targets.join(" | ")}`); ``
- `src/language-service/schema-context.ts` (line ~33): `AssignmentContext.targetConcept: string` → `targetConcepts: string[]`; set `targetConcepts: rel.targets`.
- `src/language-service/signature-help.ts` (line ~14): `` const label = `${ctx.member} ${arrow} ${ctx.targetConcepts.join(" | ")}${CARD[ctx.cardinality] ?? ""}`; ``
- Any completion code reading `targetConcept` → iterate `targetConcepts`.

- [ ] **Step 11: Update existing tests to the plural shape**

Retarget assertions (do not weaken intent):
- `ast-reference-spans.test.ts:26`: `relationships[0].targetSpan` → `targetSpans[0]`.
- `target-type.test.ts:16`: `addConceptRelationship("component", "in", "location", …)` → `addConceptRelationship("component", "in", ["location"], …)`; assertions on the mismatch message keep working (single target renders as `location`).
- `schema-context.test.ts:17`: `ctx?.targetConcept === "person"` → `ctx?.targetConcepts` `deepEqual ["person"]`.
- `schema.test.ts` / `builder.test.ts`: any `relationships[0].target` → `.targets` (`deepEqual [...]`).

- [ ] **Step 12: Run the full suite; commit**

Run: `npm test`
Expected: green (same counts, plural shape). If any consumer of a relationship `target` was missed, the typecheck/run surfaces it — fix in place.

```bash
git add -A
git commit -m "refactor(schema): relationship target -> targets[] backed by Targets edges

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Parser accepts the `|` union list

**Files:**
- Modify: `src/parse/parser.ts`
- Test: `src/parse/tests/union-relationship-target.test.ts` (create)

**Interfaces:** consumes Task 1's `RelationshipDecl.targets`. Produces multi-element `targets`/`targetSpans` from `a | b | c` syntax.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/union-relationship-target.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../parser.js';
import { DeclKind } from '../ast.js';

function rel(src: string) {
  const unit = parse('t.todl', `namespace t { concept x { relationship ${src} } }`);
  const concept = unit.declarations.find((d) => d.kind === DeclKind.Concept) as any;
  return concept.relationships[0];
}

test('a single target parses as a length-1 targets array', () => {
  const r = rel('in -> location?;');
  assert.deepEqual(r.targets, ['location']);
  assert.equal(r.targetSpans.length, 1);
});

test('a pipe-union parses into an ordered targets array', () => {
  const r = rel('from -> actor | block | component[];');
  assert.deepEqual(r.targets, ['actor', 'block', 'component']);
  assert.equal(r.targetSpans.length, 3);
});
```

Adjust the `parse` import/signature and how to reach the concept decl to match the real API (check `src/parse/tests/parser.test.ts` for the exact `parse(...)` usage and `unit` shape).

- [ ] **Step 2: Run — expect the union test to fail**

Run: `npx tsx --conditions=development --test --test-force-exit src/parse/tests/union-relationship-target.test.ts`
Expected: the single-target test passes; the union test FAILS (parser stops at `actor`, then errors on `|` or returns only `['actor']`).

- [ ] **Step 3: Parse the pipe list**

`src/parse/parser.ts` `parseRelationship`, after the first target:

```ts
    const targets = [this.parseDottedPath()];
    const targetSpans = [this.spanFrom(targetStart)];
    while (this.match(TokenKind.Pipe)) {
      const nextStart = this.current();
      targets.push(this.parseDottedPath());
      targetSpans.push(this.spanFrom(nextStart));
    }
```

- [ ] **Step 4: Run — expect pass**

Run the same file. Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parse/parser.ts src/parse/tests/union-relationship-target.test.ts
git commit -m "feat(parse): relationship targets accept a | b | c union

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Union validation is match-any + storage/order proof

**Files:**
- Test: `src/validate/tests/union-target-type.test.ts` (create)

The validation logic already unions the allowed-set (Task 1 Step 8); this task proves match-any semantics, is-a per member, the mismatch message, and that `Targets`-edge storage yields ordered `targets`. If a test fails, fix `checkTargetTypes` / `effectiveSchema`.

- [ ] **Step 1: Write the failing test**

Create `src/validate/tests/union-target-type.test.ts`, modeled on `src/validate/tests/target-type.test.ts` (reuse its `baseModel`/`targetTypeDiagnostics` helpers or replicate them). Build a concept `edge` with `relationship end -> actor | component;`, plus concepts `actor`, `component`, `location`, and a subtype `ai_agent : actor`. Then:

```ts
test('an instance target matching either union member passes', () => {
  // end -> <an actor instance>  AND  end -> <a component instance>  => 0 diagnostics
});
test('a subtype of a union member passes (is-a preserved)', () => {
  // end -> <an ai_agent instance>  => 0 diagnostics
});
test('a target outside the union is a single mismatch naming all members', () => {
  // end -> <a location instance>  => 1 TargetTypeMismatch, message contains "actor | component"
});
test('effectiveSchema returns targets in author order from Targets edges', () => {
  // model.effectiveSchema('edge').relationships find 'end' => targets deepEqual ['actor','component']
});
```

Fill in with the same construction the neighboring `target-type.test.ts` uses (`addConceptRelationship('edge','end',['actor','component'])`, instance nodes, `model.validate()`).

- [ ] **Step 2: Run — expect the union cases to drive behavior**

Run: `npx tsx --conditions=development --test --test-force-exit src/validate/tests/union-target-type.test.ts`
Expected: PASS if Task 1's union allowed-set is correct. If the mismatch message or ordering fails, fix `checkTargetTypes` (message) / `effectiveSchema` (edge read order) — do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add src/validate/tests/union-target-type.test.ts src/validate/validate.ts src/model/model.ts
git commit -m "test(validate): union relationship targets are match-any, is-a, ordered

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Emit + language-service union rendering

**Files:**
- Test: `src/emit/tests/union-relationship-emit.test.ts` (create), `src/language-service/tests/union-relationship-display.test.ts` (create)
- Modify (only if a test reveals a gap): `src/emit/js-module.ts`, `src/language-service/*`

- [ ] **Step 1: Write the failing tests**

`src/emit/tests/union-relationship-emit.test.ts`: build a model with `relationship from -> actor | component[];`, run the js-module emitter (mirror `src/emit/tests/*` setup), assert the emitted text contains `targets: ["actor", "component"]` (match the exact `jsStr` array form) and NOT a singular `target:`.

`src/language-service/tests/union-relationship-display.test.ts`: mirror `src/language-service/tests/schema-context.test.ts`; assert hover for the union relationship renders `actor | component`, and `schemaContext(...)` on that member returns `targetConcepts` deep-equal `['actor','component']`.

- [ ] **Step 2: Run — observe failures**

Run both files. Expected: emit test may already pass (Task 1 Step 9); the language-service test drives the `targetConcepts` shape if not fully done in Task 1 Step 10. Fix the emitter array form / display strings as needed.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(emit,ls): union relationship targets render as a | b

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Final gate

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Report**

Summarize commits and confirm the `target`→`targets` cutover + `Targets`-edge storage + `|` union + match-any validation. Surface the SP2 handoff: the tech-architecture meta-model can now retype `connector.from/to`, `step.src/dst`, `sequence.entry_point`, `container.delivered_by`, `application.owner`, `network-peer.network` as relationships (union where needed), and the TODL version bump + republish + Plexus `.target`→`.targets` consumer update are SP2/SP5. Do not push.

## Self-Review

- **Spec coverage:** AST/parser/loader/builder/schema/validation/references/emit/language-service — Task 1; `|` syntax — Task 2; match-any + is-a + order — Task 3; emit + display — Task 4; gate — Task 5. `Targets`-edge storage — Task 1 Steps 1/5/7, proven in Task 3. Explicit migration is SP2/SP5 (flagged in Task 5).
- **Placeholder scan:** the `parse(...)`/emitter/ls test-harness shapes are marked "match the real API in neighbor test X" rather than invented — the executor copies the exact call from the named sibling test.
- **Type consistency:** `targets: string[]` (AST) and `targets: NodeId[]` (schema) named consistently; `addConceptRelationship(…, targets: NodeId[], …)` matches its loader call site; `EdgeKind.Targets` used in builder (write) and effectiveSchema (read); `targetConcepts` used in schema-context/signature-help/completion.
