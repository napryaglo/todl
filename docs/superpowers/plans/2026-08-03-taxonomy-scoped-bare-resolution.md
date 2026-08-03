# Taxonomy-Scoped Bare Reference Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve bare (unqualified) term references inside a taxonomy — siblings implicitly, other taxonomies' terms via a `uses <tax>, …` clause — so migrated libraries compile as written.

**Architecture:** The parser accepts `uses` on a taxonomy header (mirroring the model's `uses`). During loading, a bare reference inside a term body is resolved against the enclosing taxonomy's own terms, then its `uses` list, and the AST value node is rewritten in place to the resolved qualified id — so every downstream pass (term-relationship extraction, edge building) sees the real node. Ambiguity across `uses` and unknown `uses` targets are diagnostics.

**Tech Stack:** TypeScript (ESM, strict), tests via `tsx --conditions=development --test`. Design doc: `docs/superpowers/specs/2026-08-03-taxonomy-scoped-bare-resolution-design.md`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source.
- Diagnostic codes are `DiagnosticCode` enum members, never bare string literals at use sites.
- **Non-breaking:** the full suite (`npm test`) is green after every task. Non-taxonomy references and already-qualified references keep today's behavior exactly.
- The formatter is text-based and needs no change (`uses` text is preserved as-is).
- Bare resolution applies **only to references inside a term body**; references elsewhere are unchanged.

---

### Task 1: Parse `uses` on a taxonomy header

**Files:**
- Modify: `src/parse/ast.ts` (`TaxonomyDecl`)
- Modify: `src/parse/parser.ts` (`parseTaxonomy`)
- Test: `src/parse/tests/taxonomy-uses-parse.test.ts` (create)

**Interfaces:**
- Produces: `TaxonomyDecl.uses: string[]` (+ `usesSpans?: SourceSpan[]`), consumed by Task 2/3.

- [ ] **Step 1: Extend the AST.** In `src/parse/ast.ts`, add to `TaxonomyDecl` (after `representsSpans`):

```ts
  /** The `uses <tax>, …` list of other taxonomies whose terms are in bare
   * scope for this taxonomy's term-body references; empty when omitted. */
  uses: string[];
  /** Span of each `uses` target identifier, parallel to `uses`. */
  usesSpans?: SourceSpan[];
```

- [ ] **Step 2: Write the failing test** `src/parse/tests/taxonomy-uses-parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type TaxonomyDecl } from "../ast.js";

function taxonomy(text: string): TaxonomyDecl {
  const { namespace, diagnostics } = parse(text, "t.todl");
  assert.deepEqual(diagnostics, [], "no parse diagnostics");
  const d = namespace.declarations[0]!;
  assert.equal(d.kind, DeclKind.Taxonomy);
  return d as TaxonomyDecl;
}

test("a taxonomy `uses` list parses after `represents`", () => {
  const t = taxonomy(`namespace n { taxonomy mtech : represents location, technology uses categories, roles { location a { label = "A"; } } }`);
  assert.deepEqual(t.represents, ["location", "technology"]);
  assert.deepEqual(t.uses, ["categories", "roles"]);
  assert.equal(t.terms[0]!.id, "a");
});

test("a taxonomy with no `uses` has an empty list", () => {
  const t = taxonomy(`namespace n { taxonomy roles : represents actor { actor u { label = "U"; } } }`);
  assert.deepEqual(t.uses, []);
});
```

- [ ] **Step 3: Run it to confirm it fails** — `usesundefined` / `uses` unparsed (the `uses` token makes `expect("{")` fail today).

- [ ] **Step 4: Parse the clause.** In `src/parse/parser.ts` `parseTaxonomy`, after the `while (this.match(TokenKind.Comma)) pushTarget();` line and before `this.expect(TokenKind.LBrace)`:

```ts
    const uses: string[] = [];
    const usesSpans: SourceSpan[] = [];
    if (this.checkKeyword("uses")) {
      this.advance();
      do {
        const u = this.expect(TokenKind.Identifier);
        uses.push(u.value);
        usesSpans.push(tokenSpan(u, this.uri));
      } while (this.match(TokenKind.Comma));
    }
```

Then add `uses` to the `decl` object literal and set spans:

```ts
    const decl: TaxonomyDecl = { kind: DeclKind.Taxonomy, name, represents, representsSpans, description, terms, annotations, uses, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    if (usesSpans.length > 0) decl.usesSpans = usesSpans;
```

- [ ] **Step 5: Run the test to confirm it passes** — `npm test src/parse/tests/taxonomy-uses-parse.test.ts`.

- [ ] **Step 6: Fix construction churn.** Run `npm test`. Any other `TaxonomyDecl` literal (there may be a synthesized one, e.g. `termToInstanceDecl` builds an `InstanceDecl` not a taxonomy — likely none) now needs `uses`. Add `uses: []` where the compiler flags a missing field.

- [ ] **Step 7: Commit** — `git commit -am "feat(parse): accept a uses clause on a taxonomy header"`

---

### Task 2: Taxonomy-scoped bare resolution (sibling + uses) with rewrite

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (enum member)
- Modify: `src/parse/loader.ts`
- Test: `src/parse/tests/taxonomy-bare-resolution.test.ts` (create)

**Interfaces:**
- Consumes: `TaxonomyDecl.uses` (Task 1).
- Behavior: a bare term-body ref resolves to `X.N` (sibling), else the single `Y.N` among `uses`, else existing bare resolution; on resolution the AST value node is rewritten to the qualified id.

- [ ] **Step 1: Add the ambiguity code** in `src/diagnostics/diagnostic.ts`:

```ts
  // Taxonomy bare-reference resolution.
  TaxonomyAmbiguousBareReference = "taxonomy.ambiguous-bare-reference",
```

- [ ] **Step 2: Write the failing test** `src/parse/tests/taxonomy-bare-resolution.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const errs = (ds: { code: DiagnosticCode; severity: string }[]) =>
  ds.filter((d) => d.severity === "error").map((d) => d.code);

test("a bare sibling term reference resolves within the taxonomy", () => {
  const { diagnostics } = check([{ uri: "t.todl", text:
    `namespace n {
       concept location { label : string; }
       taxonomy geo : represents location {
         location azure { label = "A"; }
         location m365  { label = "M"; parent = azure; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("a bare cross-taxonomy reference resolves through `uses`", () => {
  const base = toJSON(check([{ uri: "base.todl", text:
    `namespace ea {
       concept category { label : string; }
       concept technology { label : string; applicable-to : categories; }
       taxonomy categories : represents category { term platform-api { label = "API"; } }
     }` }]).model);
  const { diagnostics } = checkAgainst([base], [{ uri: "lib.todl", text:
    `namespace lib {
       taxonomy mtech : represents technology uses categories {
         technology graph { label = "G"; applicable-to = [platform-api]; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("without `uses`, the same cross reference is undefined", () => {
  const base = toJSON(check([{ uri: "base.todl", text:
    `namespace ea {
       concept category { label : string; }
       concept technology { label : string; applicable-to : categories; }
       taxonomy categories : represents category { term platform-api { label = "API"; } }
     }` }]).model);
  const { diagnostics } = checkAgainst([base], [{ uri: "lib.todl", text:
    `namespace lib {
       taxonomy mtech : represents technology {
         technology graph { label = "G"; applicable-to = [platform-api]; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.ReferenceUndefined));
});

test("a bare name defined by two used taxonomies is ambiguous", () => {
  const { diagnostics } = check([{ uri: "t.todl", text:
    `namespace n {
       concept c { label : string; ref : a; }
       taxonomy a : represents c { term dup { label = "1"; } }
       taxonomy b : represents c { term dup { label = "2"; } }
       taxonomy user : represents c uses a, b {
         c x { label = "X"; ref = dup; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.TaxonomyAmbiguousBareReference));
});
```

- [ ] **Step 3: Run it to confirm it fails** — sibling/uses refs currently report `reference.undefined`; ambiguity code not emitted.

- [ ] **Step 4: Implement resolution.** In `src/parse/loader.ts`:

  (a) Extend `RefSite` with the taxonomy scope and an in-place rewrite hook:

```ts
interface RefSite {
  id: string;
  span: SourceSpan | null;
  node: NodeId | null;
  path: string | null;
  /** Set for a reference inside a term body: the enclosing taxonomy and its
   * `uses` list, plus a hook that rewrites the AST value to the resolved
   * qualified id so downstream passes point at the real term node. */
  scope?: { taxonomy: string; uses: readonly string[]; rewrite: (id: string) => void };
}
```

  (b) `collectValueRefs` gains an optional `scope` param; when present, attach it (with a rewrite closure) to each Ref/Name site:

```ts
function collectValueRefs(
  value: ValueNode, sites: RefSite[], ownerNode: NodeId, memberName: string,
  memberSpan: SourceSpan | null,
  scope?: { taxonomy: string; uses: readonly string[] },
): void {
  switch (value.kind) {
    case ValueKind.Ref:
      sites.push({ id: value.ref, span: value.span ?? memberSpan ?? null, node: ownerNode, path: memberName,
        ...(scope ? { scope: { ...scope, rewrite: (r) => { (value as { ref: string }).ref = r; } } } : {}) });
      break;
    case ValueKind.Name:
      sites.push({ id: value.name, span: memberSpan ?? null, node: ownerNode, path: memberName,
        ...(scope ? { scope: { ...scope, rewrite: (r) => { (value as { name: string }).name = r; } } } : {}) });
      break;
    case ValueKind.List:
      for (const item of value.items) collectValueRefs(item, sites, ownerNode, memberName, memberSpan, scope);
      break;
    case ValueKind.String:
    case ValueKind.Composite:
      break;
  }
}
```

  (c) In `collectNames`, the taxonomy branch passes the scope when walking term assignments:

```ts
      const scope = { taxonomy: declaration.name, uses: declaration.uses };
      const add = (t: Term): void => {
        defined.add(`${declaration.name}.${t.id}`);
        for (const assignment of t.assignments) {
          collectValueRefs(assignment.value, sites, `${declaration.name}.${t.id}`, assignment.name, assignment.span ?? null, scope);
        }
        t.children.forEach(add);
      };
      declaration.terms.forEach(add);
```

  (d) Replace the reference-resolution loop so it runs **before Pass 1** (move it to immediately after the `collectNames` loop, ahead of `const first = model.builder();`) and applies scope resolution + rewrite:

```ts
  const undefinedIds = new Set<string>();
  const has = (id: string): boolean => defined.has(id) || model.has(id);
  for (const site of sites) {
    if (has(site.id)) continue;                 // resolves as written
    if (site.scope !== undefined) {
      const sibling = `${site.scope.taxonomy}.${site.id}`;
      if (has(sibling)) { site.scope.rewrite(sibling); continue; }   // sibling shadows uses
      const matches = site.scope.uses.map((u) => `${u}.${site.id}`).filter(has);
      if (matches.length === 1) { site.scope.rewrite(matches[0]!); continue; }
      if (matches.length > 1) {
        diagnostics.push({
          code: DiagnosticCode.TaxonomyAmbiguousBareReference,
          severity: Severity.Error,
          message: `bare reference "${site.id}" is defined by more than one used taxonomy (${matches.join(", ")}); qualify it`,
          span: site.span, node: site.node, path: site.path,
        });
        continue;
      }
    }
    undefinedIds.add(site.id);
    diagnostics.push({
      code: DiagnosticCode.ReferenceUndefined,
      severity: Severity.Error,
      message: `reference to undefined symbol "${site.id}"`,
      span: site.span, node: site.node, path: site.path,
    });
  }
```

Delete the original post-Pass-1 undefined loop (the rewrite must happen before `defineTaxonomy`/`termRelationships` reads the values in Pass 1). Pass 1's `first.commit(undefinedIds)` still receives the set built above.

- [ ] **Step 5: Run the new test to confirm it passes** — `npm test src/parse/tests/taxonomy-bare-resolution.test.ts`.

- [ ] **Step 6: Run the full suite** — `npm test`. Reordering resolution before Pass 1 must not change any existing diagnostic. Investigate any change rather than re-baselining.

- [ ] **Step 7: Commit** — `git commit -am "feat(loader): resolve bare taxonomy term refs via siblings + uses"`

---

### Task 3: Validate `uses` targets

**Files:**
- Modify: `src/diagnostics/diagnostic.ts` (enum member)
- Modify: `src/parse/loader.ts`
- Test: `src/parse/tests/taxonomy-uses-validate.test.ts` (create)

**Interfaces:**
- A `uses` entry that does not name a known taxonomy (source or base) → `taxonomy.uses-undefined`.

- [ ] **Step 1: Add the code** in `src/diagnostics/diagnostic.ts`:

```ts
  TaxonomyUsesUndefined = "taxonomy.uses-undefined",
```

- [ ] **Step 2: Write the failing test** `src/parse/tests/taxonomy-uses-validate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (text: string) => check([{ uri: "t.todl", text }]).diagnostics.map((d) => d.code);

test("`uses` naming an unknown taxonomy is taxonomy.uses-undefined", () => {
  assert.ok(codes(
    `namespace n { concept c { label : string; } taxonomy t : represents c uses ghost { c a { label = "A"; } } }`,
  ).includes(DiagnosticCode.TaxonomyUsesUndefined));
});

test("`uses` naming a non-taxonomy (a concept) is taxonomy.uses-undefined", () => {
  assert.ok(codes(
    `namespace n { concept c { label : string; } concept other { label : string; } taxonomy t : represents c uses other { c a { label = "A"; } } }`,
  ).includes(DiagnosticCode.TaxonomyUsesUndefined));
});

test("`uses` naming a real taxonomy is clean", () => {
  assert.ok(!codes(
    `namespace n { concept c { label : string; } taxonomy real : represents c { term k { label = "K"; } } taxonomy t : represents c uses real { c a { label = "A"; } } }`,
  ).includes(DiagnosticCode.TaxonomyUsesUndefined));
});
```

- [ ] **Step 3: Run it to confirm it fails.**

- [ ] **Step 4: Implement.** In `src/parse/loader.ts`, build the set of known taxonomy names (source declarations + base nodes typed taxonomy) and validate each taxonomy's `uses`. Add after `collectNames` (uses `units`/`declarations` and `model`):

```ts
  const taxonomyNames = new Set<string>();
  for (const decl of declarations) if (decl.kind === DeclKind.Taxonomy) taxonomyNames.add(decl.name);
  for (const n of model.allNodes()) if (n.typeOf === MetaKind.Taxonomy) taxonomyNames.add(n.id);
  for (const { decl } of units) {
    if (decl.kind !== DeclKind.Taxonomy) continue;
    decl.uses.forEach((u, i) => {
      if (taxonomyNames.has(u)) return;
      diagnostics.push({
        code: DiagnosticCode.TaxonomyUsesUndefined,
        severity: Severity.Error,
        message: `taxonomy "${decl.name}" uses "${u}", which is not a known taxonomy`,
        span: decl.usesSpans?.[i] ?? decl.span, node: decl.name, path: null,
      });
    });
  }
```

Import `MetaKind` from `../model/kinds.js` if not already imported. (`Repository.allNodes()` / `node.typeOf` are the same accessors the validator uses.)

- [ ] **Step 5: Run the new test to confirm it passes.**

- [ ] **Step 6: Run the full suite** — `npm test`.

- [ ] **Step 7: Commit** — `git commit -am "feat(loader): diagnose unknown taxonomy uses targets"`

---

### Task 4: End-to-end integration proof

**Files:**
- Test: `src/tests/taxonomy-library-migration.test.ts` (create)

**Interfaces:** none — an integration test mirroring the migrated-library shape (base meta-model taxonomy + a downstream library taxonomy using sibling refs and `uses`).

- [ ] **Step 1: Write the integration test** `src/tests/taxonomy-library-migration.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../api.js";
import { toJSON } from "../emit/json.js";

test("a migrated-style library compiles clean: bare siblings + uses cross-refs", () => {
  const base = toJSON(check([{ uri: "ea.todl", text:
    `namespace tech-architecture {
       concept location { label : string; parent : location?; }
       concept category { label : string; }
       concept technology { label : string; available-in : location; applicable-to : categories; }
       taxonomy categories : represents category {
         term platform-api { label = "API"; }
         term conversational-interface { label = "Chat"; }
       }
     }` }]).model);

  const lib = `namespace libraries.microsoft {
    taxonomy microsoft-tech : represents location, technology uses categories {
      location azure { label = "Azure"; }
      location m365  { label = "Microsoft 365"; parent = azure; }
      technology graph {
        label = "Microsoft Graph";
        available-in  = [m365];
        applicable-to = [platform-api];
      }
      technology teams {
        label = "Microsoft Teams";
        available-in  = [m365];
        applicable-to = [conversational-interface];
      }
    }
  }`;

  const { diagnostics } = checkAgainst([base], [{ uri: "microsoft.todl", text: lib }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), [], "library compiles clean");
});
```

- [ ] **Step 2: Run it to confirm it passes** (all prior tasks landed) — `npm test src/tests/taxonomy-library-migration.test.ts`.

- [ ] **Step 3: Full suite + typecheck** — `npm test && npm run typecheck`.

- [ ] **Step 4: Commit** — `git commit -am "test: migrated-style library with bare siblings + uses compiles clean"`

- [ ] **Step 5: (manual, not committed) verify the real file.** Compile `plexus_tests/libraries/microsoft/microsoft.todl` against the published `tech-architecture` `model.json` and confirm the 518 `reference.undefined` errors are gone. Note any residual unresolved names (terms the file references that neither its taxonomy nor `categories` defines) for follow-up — those are genuine authoring gaps, not resolution failures.

---

## Self-Review

- **Spec coverage:** sibling-implicit + `uses` parse (Task 1), resolution order with rewrite + ambiguity (Task 2), `uses`-target validation (Task 3), migration-shape proof (Task 4). Formatter is text-based → no task (per spec §5, confirmed).
- **Type consistency:** `TaxonomyDecl.uses` defined in Task 1 is read in Tasks 2–3; `RefSite.scope` carries the rewrite hook used in Task 2's resolution loop; both new `DiagnosticCode` members are added before use.
- **Ordering hazard (called out in Task 2 Step 4):** resolution + AST rewrite MUST run before Pass 1, because `defineTaxonomy` → `termRelationships` reads term value refs during Pass 1. Moving the loop earlier is the crux of the change.
- **Non-goals honored:** no global bare resolution, no type-directed resolution; only term-body refs get scope treatment (non-taxonomy refs pass `scope: undefined`).
- **Open sub-points (spec):** diagnostic code names finalized here (`taxonomy.ambiguous-bare-reference`, `taxonomy.uses-undefined`); sibling-shadows-uses is silent (most-local wins); nested sub-term refs resolve against the whole taxonomy's flat term ids (Task 2's `sibling = <tax>.<id>` uses the taxonomy-flat id scheme).
