# TODL Viewpoint Construct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class meta-model construct `viewpoint <Name> : frames <Concept>, …` to TODL — an ontology-tier entity that lists the concepts it frames, mirroring `taxonomy … represents …` minus terms/hierarchy.

**Architecture:** Every piece parallels the existing taxonomy construct: a new `DeclKind.Viewpoint` + `ViewpointDecl` AST node and `parseViewpoint`; a new `MetaKind.Viewpoint` node kind and `EdgeKind.Frames` edge kind; a `Builder.defineViewpoint`; `frames`/`framedBy`/`viewpoints`/`viewpointsFraming` Repository queries; frames references resolved through the shared `visitReferences` machinery (like `represents`); and validation for empty/non-concept frames. No `conforms`, no models, no Plexus.

**Tech Stack:** TypeScript (ESM, strict), `@pragmatic-tech-ai/todl`. Node test runner via `tsx`.

## Global Constraints

- ESM, strict tsconfig. Run the full suite with `tsx --conditions=development --test "src/**/*.test.ts"`; a single file with `tsx --conditions=development --test <path>`.
- Real TS enums (`DeclKind`, `MetaKind`, `EdgeKind`, `DiagnosticCode`) — extend existing enums, never string-literal unions.
- Every test file lives in a `tests/` subfolder next to the source it exercises.
- Append `EdgeKind.Frames` at the END of the `EdgeKind` enum so existing numeric edge-kind values (serialized in `TodlDocument` JSON) are unchanged.
- Surface syntax: `viewpoint <Name> : frames <Concept>[, <Concept>]*` — colon before `frames`, NO body block.

---

### Task 1: AST + parser for `viewpoint … : frames …`

**Files:**
- Modify: `src/parse/ast.ts` (add `DeclKind.Viewpoint`, `ViewpointDecl`, extend `Declaration` union)
- Modify: `src/parse/parser.ts` (add `parseViewpoint`, dispatch after taxonomy)
- Test: `src/parse/tests/viewpoint-parse.test.ts`

**Interfaces:**
- Produces: `DeclKind.Viewpoint`; `interface ViewpointDecl { kind: DeclKind.Viewpoint; name: string; frames: string[]; framesSpans?: SourceSpan[]; span: SourceSpan; nameSpan?: SourceSpan }`; `ViewpointDecl` is a member of the `Declaration` union.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/viewpoint-parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type ViewpointDecl } from "../ast.js";

function viewpoint(src: string): ViewpointDecl {
  const { namespace } = parse(`namespace n {\n${src}\n}`, "t.todl");
  const decl = namespace.declarations.find((d) => d.kind === DeclKind.Viewpoint);
  assert.ok(decl, "expected a viewpoint declaration");
  return decl as ViewpointDecl;
}

test("viewpoint parses a single framed concept", () => {
  const v = viewpoint(`viewpoint ComponentView : frames Component`);
  assert.equal(v.name, "ComponentView");
  assert.deepEqual(v.frames, ["Component"]);
});

test("viewpoint parses multiple comma-separated framed concepts", () => {
  const v = viewpoint(`viewpoint ComponentView : frames Component, Interface, Node`);
  assert.deepEqual(v.frames, ["Component", "Interface", "Node"]);
  assert.equal(v.framesSpans?.length, 3);
});

test("viewpoint accepts namespace-qualified frames targets", () => {
  const v = viewpoint(`viewpoint V : frames archmm.Component`);
  assert.deepEqual(v.frames, ["archmm.Component"]);
});

test("a viewpoint (no body) is followed cleanly by the next declaration", () => {
  const { namespace } = parse(
    `namespace n {\nviewpoint V : frames Component\nconcept Component {}\n}`,
    "t.todl",
  );
  const kinds = namespace.declarations.map((d) => d.kind);
  assert.ok(kinds.includes(DeclKind.Viewpoint));
  assert.ok(kinds.includes(DeclKind.Concept));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tsx --conditions=development --test src/parse/tests/viewpoint-parse.test.ts`
Expected: FAIL — `ViewpointDecl` not exported / `DeclKind.Viewpoint` undefined / no viewpoint declaration parsed.

- [ ] **Step 3: Extend the AST**

In `src/parse/ast.ts`, add `Viewpoint` to the `DeclKind` enum (append after `Taxonomy`):

```ts
export enum DeclKind {
  Primitive,
  Taxonomy,
  Viewpoint,
  Concept,
  Instance,
  Model,
  Annotation,
  Package,
}
```

Add the `ViewpointDecl` interface next to `TaxonomyDecl`:

```ts
export interface ViewpointDecl {
  kind: DeclKind.Viewpoint;
  name: string;
  /** The concepts this viewpoint frames (`viewpoint X : frames C1, C2`). */
  frames: string[];
  /** Span of each `frames` target identifier, parallel to `frames`. */
  framesSpans?: SourceSpan[];
  span: SourceSpan;
  /** Span of the viewpoint's name identifier. */
  nameSpan?: SourceSpan;
}
```

Add it to the `Declaration` union:

```ts
export type Declaration =
  | ConceptDecl | TaxonomyDecl | ViewpointDecl | PrimitiveDecl | InstanceDecl | ModelDecl
  | AnnotationDecl | PackageDecl;
```

- [ ] **Step 4: Add the parser**

In `src/parse/parser.ts`, add the dispatch line in `parseDeclaration` immediately after the taxonomy dispatch:

```ts
    if (this.checkKeyword("taxonomy")) return this.parseTaxonomy(start);
    if (this.checkKeyword("viewpoint")) return this.parseViewpoint(start);
```

Add the `parseViewpoint` method next to `parseTaxonomy` (mirrors it, minus `uses`/terms/body):

```ts
  private parseViewpoint(start: Token): ViewpointDecl {
    this.expectKeyword("viewpoint");
    const nameTok = this.expect(TokenKind.Identifier);
    const name = nameTok.value;
    this.expect(TokenKind.Colon);
    this.expectKeyword("frames");
    const frames: string[] = [];
    const framesSpans: SourceSpan[] = [];
    // frames targets may be namespace-qualified (`ns.Concept`); parseDottedPath
    // accepts a bare name too, so unqualified authoring is unchanged.
    const pushTarget = (): void => {
      const startTok = this.current();
      frames.push(this.parseDottedPath());
      framesSpans.push(this.spanFrom(startTok));
    };
    pushTarget();
    while (this.match(TokenKind.Comma)) pushTarget();
    // No body block — a viewpoint has no terms; the declaration ends here.
    const decl: ViewpointDecl = { kind: DeclKind.Viewpoint, name, frames, framesSpans, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    return decl;
  }
```

Ensure `ViewpointDecl` is imported from `./ast.js` in the parser's import block (add it alongside `TaxonomyDecl`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `tsx --conditions=development --test src/parse/tests/viewpoint-parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `tsx --conditions=development --test "src/**/*.test.ts"`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/parse/ast.ts src/parse/parser.ts src/parse/tests/viewpoint-parse.test.ts
git commit -m "feat(todl): parse viewpoint <Name> : frames <concepts>"
```

---

### Task 2: Model kind, Frames edge, builder, and queries

**Files:**
- Modify: `src/model/kinds.ts` (add `MetaKind.Viewpoint`)
- Modify: `src/model/graph.ts` (append `EdgeKind.Frames`)
- Modify: `src/model/builder.ts` (add `defineViewpoint`)
- Modify: `src/model/model.ts` (add `frames`, `framedBy`, `viewpoints`, `viewpointsFraming`)
- Test: `src/model/tests/viewpoint-model.test.ts`

**Interfaces:**
- Consumes: nothing (independent of Task 1).
- Produces: `MetaKind.Viewpoint = "viewpoint"`; `EdgeKind.Frames`; `Builder.defineViewpoint(name: NodeId, frames: readonly NodeId[]): this`; `Repository.frames(vp): NodeId[]`, `Repository.framedBy(concept): NodeId[]`, `Repository.viewpoints(): NodeId[]`, `Repository.viewpointsFraming(concept): NodeId[]`.

- [ ] **Step 1: Write the failing test**

Create `src/model/tests/viewpoint-model.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../graph.js";
import { Repository } from "../model.js";
import { MetaKind } from "../kinds.js";

function built() {
  const repo = new Repository(new Graph());
  const b = repo.builder();
  b.defineConcept("Component");
  b.defineConcept("Interface");
  b.defineConcept("WebComponent", "Component"); // WebComponent extends Component
  b.defineViewpoint("ComponentView", ["Component", "Interface"]);
  b.commit();
  return repo;
}

test("a viewpoint node is ontology-typed MetaKind.Viewpoint", () => {
  const repo = built();
  assert.equal(repo.resolve("ComponentView")?.typeOf, MetaKind.Viewpoint);
});

test("frames() returns the framed concepts; framedBy() is the inverse", () => {
  const repo = built();
  assert.deepEqual(repo.frames("ComponentView").sort(), ["Component", "Interface"]);
  assert.deepEqual(repo.framedBy("Component"), ["ComponentView"]);
  assert.deepEqual(repo.framedBy("Interface"), ["ComponentView"]);
});

test("viewpoints() lists every viewpoint", () => {
  const repo = built();
  assert.deepEqual(repo.viewpoints(), ["ComponentView"]);
});

test("viewpointsFraming() is subtype-aware: a subtype of a framed concept is framed", () => {
  const repo = built();
  // WebComponent is not framed directly, but its supertype Component is.
  assert.deepEqual(repo.framedBy("WebComponent"), []);
  assert.deepEqual(repo.viewpointsFraming("WebComponent"), ["ComponentView"]);
  assert.deepEqual(repo.viewpointsFraming("Component"), ["ComponentView"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tsx --conditions=development --test src/model/tests/viewpoint-model.test.ts`
Expected: FAIL — `MetaKind.Viewpoint`, `defineViewpoint`, and the query methods don't exist.

- [ ] **Step 3: Add the model kind**

In `src/model/kinds.ts`, add to the `MetaKind` enum (after `Taxonomy`):

```ts
export enum MetaKind {
  Concept = "concept",
  Primitive = "primitive",
  Taxonomy = "taxonomy",
  Viewpoint = "viewpoint",
  Field = "field",
  Relationship = "relationship",
  Model = "model",
  Annotation = "annotation",
  Package = "package",
}
```

- [ ] **Step 4: Add the Frames edge kind**

In `src/model/graph.ts`, append `Frames` at the END of the `EdgeKind` enum (after `Annotated`):

```ts
export enum EdgeKind {
  TypeOf,
  Extends,
  Contains,
  HasField,
  HasRelationship,
  HasInvariant,
  Relationship,
  Derived,
  Narrower,
  InstanceOf,
  Represents,
  Annotated,
  Frames, // viewpoint -> the concept it frames
}
```

- [ ] **Step 5: Add the builder method**

In `src/model/builder.ts`, add `defineViewpoint` next to `defineTaxonomy` (mirrors it, no terms):

```ts
  /** Define a viewpoint node framing the given concepts (one Frames edge each). */
  defineViewpoint(name: NodeId, frames: readonly NodeId[]): this {
    this.stageNode(name, Tier.Ontology, MetaKind.Viewpoint);
    for (const concept of frames) {
      this.stagedEdges.push({ kind: EdgeKind.Frames, via: null, from: name, to: concept });
    }
    return this;
  }
```

(`EdgeKind`, `MetaKind`, and `Tier` are already imported in builder.ts for `defineTaxonomy`.)

- [ ] **Step 6: Add the Repository queries**

In `src/model/model.ts`, add next to `represents`/`representedBy`:

```ts
  /** The concepts a viewpoint frames (one or more; empty if none). */
  frames(viewpoint: NodeId): NodeId[] {
    return this.graph.related(viewpoint, EdgeKind.Frames, Direction.Out);
  }

  /** Every viewpoint that frames `concept` directly. */
  framedBy(concept: NodeId): NodeId[] {
    return this.graph.related(concept, EdgeKind.Frames, Direction.In);
  }

  /** Every viewpoint in the model. */
  viewpoints(): NodeId[] {
    return this.instancesOf(MetaKind.Viewpoint);
  }

  /** Every viewpoint that frames `concept` OR any of its supertypes
   *  (subtype-aware: a subtype of a framed concept is framed). */
  viewpointsFraming(concept: NodeId): NodeId[] {
    const seen = new Set<NodeId>();
    for (const c of [concept, ...this.supertypesOf(concept)]) {
      for (const vp of this.framedBy(c)) seen.add(vp);
    }
    return [...seen];
  }
```

(`EdgeKind`, `Direction`, and `MetaKind` are already imported in model.ts.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `tsx --conditions=development --test src/model/tests/viewpoint-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Run the full suite (no regressions)**

Run: `tsx --conditions=development --test "src/**/*.test.ts"`
Expected: all green (confirms appending `EdgeKind.Frames` broke no serialized ordinals).

- [ ] **Step 9: Commit**

```bash
git add src/model/kinds.ts src/model/graph.ts src/model/builder.ts src/model/model.ts src/model/tests/viewpoint-model.test.ts
git commit -m "feat(todl): viewpoint model kind, Frames edge, builder + queries"
```

---

### Task 3: Load viewpoints (references + loader wiring)

**Files:**
- Modify: `src/parse/references.ts` (add `RefRole.Frames`; `collectDefinitions` + `visitReferences` cases)
- Modify: `src/parse/loader.ts` (Pass-1 `defineViewpoint`; `recordSpans` case)
- Test: `src/parse/tests/viewpoint-load.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ViewpointDecl`, `DeclKind.Viewpoint`); Task 2 (`Builder.defineViewpoint`, `Repository.frames`, `MetaKind.Viewpoint`, `EdgeKind.Frames`).
- Produces: loading `viewpoint V : frames C` builds a `MetaKind.Viewpoint` node with `Frames` edges; unknown frames resolve as `reference.undefined`/`reference.unreachable` and drop the edge; qualified frames rewrite to flat ids.

- [ ] **Step 1: Write the failing test**

Create `src/parse/tests/viewpoint-load.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { MetaKind } from "../../model/kinds.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function loadResult(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]);
}
function repo(text: string) {
  return loadResult(text).model;
}

test("a viewpoint loads as an ontology node with Frames edges", () => {
  const m = repo(`concept Component {} concept Interface {}
    viewpoint ComponentView : frames Component, Interface`);
  assert.equal(m.resolve("ComponentView")?.typeOf, MetaKind.Viewpoint);
  assert.deepEqual(m.related("ComponentView", EdgeKind.Frames, Direction.Out).sort(), ["Component", "Interface"]);
  assert.deepEqual(m.frames("ComponentView").sort(), ["Component", "Interface"]);
});

test("an unknown framed concept is reported undefined and drops the edge", () => {
  const { model, diagnostics } = loadResult(`viewpoint V : frames Missing`);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined));
  assert.deepEqual(model.frames("V"), []); // no dangling Frames edge
});

test("a qualified framed concept rewrites to its flat id", () => {
  // Component defined in namespace n; qualified n.Component resolves + flattens.
  const { model, diagnostics } = loadResult(`concept Component {}
    viewpoint V : frames n.Component`);
  assert.equal(diagnostics.length, 0);
  assert.deepEqual(model.frames("V"), ["Component"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tsx --conditions=development --test src/parse/tests/viewpoint-load.test.ts`
Expected: FAIL — the loader has no `DeclKind.Viewpoint` handling, so no viewpoint node/edges are built.

- [ ] **Step 3: Wire references**

In `src/parse/references.ts`:

Add `Frames` to the `RefRole` enum (next to `Represents`):

```ts
export enum RefRole {
  // …existing members…
  Represents,
  Frames,
  // …rest…
}
```

In `collectDefinitions`'s `switch (decl.kind)`, add a case (define the viewpoint's own name):

```ts
    case DeclKind.Viewpoint:
      define(decl.name);
      break;
```

In `visitReferences`'s `switch (decl.kind)`, add a case mirroring the `Taxonomy`/`represents` visit:

```ts
    case DeclKind.Viewpoint: {
      decl.frames.forEach((c, i) => visit({
        name: c, span: decl.framesSpans?.[i] ?? decl.span, role: RefRole.Frames,
        ownerNode: decl.name, memberPath: null, rewrite: (r) => { decl.frames[i] = r; },
      }));
      break;
    }
```

- [ ] **Step 4: Wire the loader**

In `src/parse/loader.ts`, in the Pass-1 `switch (declaration.kind)` (the loop that calls `first.define*`), add:

```ts
      case DeclKind.Viewpoint:
        first.defineViewpoint(declaration.name, declaration.frames);
        break;
```

In `recordSpans`'s `switch (declaration.kind)`, add:

```ts
      case DeclKind.Viewpoint:
        model.recordSpan(declaration.name, declaration.span);
        break;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `tsx --conditions=development --test src/parse/tests/viewpoint-load.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `tsx --conditions=development --test "src/**/*.test.ts"`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/parse/references.ts src/parse/loader.ts src/parse/tests/viewpoint-load.test.ts
git commit -m "feat(todl): load viewpoints, resolve frames references"
```

---

### Task 4: Validate viewpoints (empty / non-concept frames)

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (add two `DiagnosticCode`s)
- Modify: `src/validate/validate.ts` (add `checkFrames` + dispatch)
- Test: `src/validate/tests/viewpoint-validate.test.ts`

**Interfaces:**
- Consumes: Task 2 (`MetaKind.Viewpoint`, `Repository.frames`); Task 3 (loading a viewpoint that frames a non-concept).
- Produces: `DiagnosticCode.ViewpointNoFramedConcept = "viewpoint.no-framed-concept"`, `DiagnosticCode.ViewpointFramesNotConcept = "viewpoint.frames-not-concept"`.

- [ ] **Step 1: Write the failing test**

Create `src/validate/tests/viewpoint-validate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, Tier } from "../../model/graph.js";
import { Repository } from "../../model/model.js";
import { MetaKind } from "../../model/kinds.js";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

test("a viewpoint that frames nothing is flagged (graph-built backstop)", () => {
  // The parser requires >=1 frames target, so this state is only reachable
  // for a graph-built / base-composed viewpoint node with no Frames edges.
  const g = new Graph();
  g.addNode({ id: "Empty", tier: Tier.Ontology, typeOf: MetaKind.Viewpoint, attrs: new Map() });
  const codes = new Repository(g).validate().map((d) => d.code);
  assert.ok(codes.includes(DiagnosticCode.ViewpointNoFramedConcept));
});

test("a viewpoint that frames a non-concept is flagged", () => {
  // T is a taxonomy, not a concept.
  const { diagnostics } = check([{
    uri: "t.todl",
    text: `namespace n {\nconcept C {}\ntaxonomy T : represents C {}\nviewpoint V : frames T\n}`,
  }]);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ViewpointFramesNotConcept));
});

test("a viewpoint that frames a concept is clean", () => {
  const { diagnostics } = check([{
    uri: "t.todl",
    text: `namespace n {\nconcept Component {}\nviewpoint V : frames Component\n}`,
  }]);
  assert.equal(diagnostics.filter((d) =>
    d.code === DiagnosticCode.ViewpointNoFramedConcept ||
    d.code === DiagnosticCode.ViewpointFramesNotConcept).length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tsx --conditions=development --test src/validate/tests/viewpoint-validate.test.ts`
Expected: FAIL — the new `DiagnosticCode`s don't exist / no `checkFrames` runs.

- [ ] **Step 3: Add the diagnostic codes**

In `src/diagnostics/diagnostic.ts`, add to the `DiagnosticCode` enum (near the taxonomy codes):

```ts
  ViewpointNoFramedConcept = "viewpoint.no-framed-concept",
  ViewpointFramesNotConcept = "viewpoint.frames-not-concept",
```

- [ ] **Step 4: Add the validation**

In `src/validate/validate.ts`, in the `validate` function's node loop, add a dispatch parallel to the taxonomy branch:

```ts
    if (node.tier === Tier.Ontology && node.typeOf === MetaKind.Viewpoint) {
      checkFrames(diagnostics, model, node);
      continue;
    }
```

Add the `checkFrames` function next to `checkRepresents`:

```ts
/** A viewpoint must frame at least one concept, and every framed target must be
 *  a concept (not a taxonomy/primitive/etc.). */
function checkFrames(out: Diagnostic[], model: Repository, node: Node): void {
  const framed = model.frames(node.id);
  if (framed.length === 0) {
    out.push(
      error(
        DiagnosticCode.ViewpointNoFramedConcept,
        node.id,
        node.id,
        `viewpoint "${node.id}" frames no concept`,
        spanFor(model, node.id, null),
      ),
    );
    return;
  }
  for (const framedId of framed) {
    const target = model.resolve(framedId);
    if (target === undefined || target.typeOf !== MetaKind.Concept) {
      out.push(
        error(
          DiagnosticCode.ViewpointFramesNotConcept,
          node.id,
          node.id,
          `viewpoint "${node.id}" frames "${framedId}", which is not a concept`,
          spanFor(model, node.id, null),
        ),
      );
    }
  }
}
```

(`Node`, `Repository`, `Diagnostic`, `error`, `spanFor`, `Tier`, and `MetaKind` are already imported/used by the taxonomy checks in this file.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `tsx --conditions=development --test src/validate/tests/viewpoint-validate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `tsx --conditions=development --test "src/**/*.test.ts"`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/diagnostics/diagnostic.ts src/validate/validate.ts src/validate/tests/viewpoint-validate.test.ts
git commit -m "feat(todl): validate viewpoint frames (empty / non-concept)"
```

---

## Notes

- **JS-module emit is intentionally out of scope** (spec §3.6): viewpoints flow to consumers through the `TodlDocument` graph JSON via `Repository.frames()`/`viewpoints()`; no `.todl` or JS-module emit is needed until a typed-runtime consumer requires it.
- After Task 4, the construct is complete for the vocabulary layer. Sub-projects 2–4 (the model `conforms` clause, multi-file draft, `ArchitectureModelService`, diagram viewpoint scoping) consume `viewpoints()`, `frames()`, `framedBy()`, and `viewpointsFraming()`.
