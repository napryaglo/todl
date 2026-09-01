# TODL C-like Identifiers — Design (Sub-project 1: TODL language + self-migration)

**Date:** 2026-08-06
**Status:** Approved, ready for planning
**Repo:** TODL (`@pragmatic-tech-ai/todl`)
**Part of:** a 3-stage effort — **SP1 (this spec):** TODL grammar cutover + recaser tool + migrate TODL's own corpus + publish. **SP2 (separate):** migrate the Plexus meta-model/library corpus + emitters, bump. **SP3 (separate):** resume the parked mural-resource-keys feature, now with PascalCase names legal.

## Goal

Replace TODL's kebab-case identifier grammar with **C-like identifiers** (`[A-Za-z_][A-Za-z0-9_]*`, hyphens no longer identifier characters), migrate all of TODL's own corpus to the new casing convention, and publish. After SP1, TODL compiles C-like source, rejects kebab, and ships green.

## Motivation

TODL identifiers are currently lowercase kebab (`app-component`, `depends-on`). The `-` character is consumed into identifiers by the lexer ([lexer.ts:172](../../src/parse/lexer.ts)). This blocks PascalCase/underscore names (e.g. the mural `MuralResource`/`Key` annotations that motivated this) and diverges from mainstream C-family languages. We are cutting over to C-like identifiers outright — not adding them alongside kebab — so the language has a single, idiomatic identifier form.

## Locked decisions

1. **Grammar: C-like, hard cutover.** Identifiers are `[A-Za-z_][A-Za-z0-9_]*`. Hyphens are removed from the identifier grammar entirely; a stray `-` (outside `->`/`-->`) is an `unexpected character`. (Verified: no TODL construct uses a standalone `-`; there are no negative-number literals. Arrows `->`/`-->` are matched as multi-char tokens before identifier scanning and are unaffected.)
2. **Casing convention: PascalCase types, camelCase members.**
   - **User-defined types → PascalCase**, at declaration and every reference: `concept`, user `primitive`, `taxonomy`, `relationship`, `annotation`, `model`, `enum`, and taxonomy **`term`** names. (`app-component` → `AppComponent`; `: component` → `: Component`; `represents actor` → `represents Actor`; `annotate icon` → `annotate Icon`; `term user` → `term User`.)
   - **Members → camelCase**: field names, relationship member-names, annotation param names. (`hosted-by : technology` → `hostedBy : Technology`.) A member name and its type legitimately diverge (`dependsOn : DependsOn`) — coherent, since references resolve by type.
   - **Built-in primitive keywords `string` / `number` / `boolean` stay lowercase** (reserved keywords, C-style). Only user-defined primitives capitalize (`identifier` → `Identifier`, `slug` → `Slug`, `label` → `Label`).
   - **Namespaces / package ids stay lowercase.** Multi-word namespace segments de-hyphenate to **lowercase-first camel** (`adl.meta-models.bpmn` → `adl.metaModels.bpmn`) to remain legal identifiers without capitalizing.
   - **Identifier-valued string attributes follow their referent**: e.g. the `instance` annotation's `concept = "app-component"` → `"AppComponent"`.
3. **Migration tool: a grammar-aware recaser** (not a compiler-driven whole-doc rewriter), because the bulk of TODL's corpus is `.todl` **fragments embedded in ~170 `.ts` test files**, which a whole-document resolver cannot process. The recaser classifies each identifier token by local grammar context (neighbouring keywords/punctuation) and recases it. It is a reusable module (SP2 applies it to the Plexus corpus).
4. **Oracle-driven cleanup.** The TODL test suite is the migration oracle: after recasing, run the suite; each failure pinpoints a mis-recased snippet or a stale TS assertion string. Iterate to green.

## Architecture

### Component 1 — the recaser (`src/migrate/recase.ts`)

A pure `recaseSource(text: string): string` that tokenizes with a **kebab-capable** tokenizer (the current lexer, before Component 2 flips it — so the recaser can still read kebab input), classifies each `Identifier` token, and rewrites its span. Token-context classification rules, in precedence order:

| # | Context (local token neighbours) | Role | Casing |
|---|---|---|---|
| 1 | Preceded by a type-declaring keyword: `concept`, `primitive`, `taxonomy`, `annotation`, `relationship`, `model`, `enum`, `term` | type decl name | **Pascal** |
| 2 | Preceded by `namespace`, or `package`, or a `.` inside a namespace/qualified prefix | namespace/package segment | **lowercase** (multi-word → camel) |
| 3 | Is `string` / `number` / `boolean` | built-in primitive | **unchanged** |
| 4 | Preceded by `:`, `represents`, `uses`, `annotate`, `->`, `-->` | type reference | **Pascal** |
| 5 | Followed by `:` (member decl) or `=` (attr/param key), and not matched above | member/param name | **camel** |
| 6 | Last segment of a dotted qualified name `ns.sub.X` | recase `X` by its role (rules 1/4 ⇒ Pascal); leading segments = rule 2 | per role |
| 7 | otherwise (ambiguous bare identifier) | leave unchanged | **unchanged** (oracle catches) |

Casing helpers (shared with Component 6): `toPascal(kebab)`, `toCamel(kebab)` split on `-` and recase (kebab is the known input shape here). A small allowlist of identifier-denoting **string-value** keys — `concept`, `via` (the `instance` annotation params) — additionally recases matching `"kebab"` string literals to Pascal; all other string literals are left to the oracle.

A thin runner (`src/migrate/recase-run.ts`, mirroring `run.ts`) recases a file tree in place for the `.todl` fixtures, and a helper recases `.todl` template-literal fragments inside `.ts` files (find backtick literals containing TODL keywords, recase their content, splice back; `${…}` interpolations are passed through opaquely).

**Tests** (`src/migrate/tests/recase.test.ts`): representative snippets covering every rule — concept decl + supertype, field (member vs type divergence), relationship decl + arrow reference, taxonomy + `represents` + `term`, annotation decl + `annotate` application, built-in primitives left lowercase, namespace left lowercase + hyphenated segment → camel, dotted qualified reference, `instance { concept = "app-component" }` → `"AppComponent"`.

### Component 2 — lexer cutover (`src/parse/lexer.ts`)

- `isIdentifierStart(c)` → `(c>='a'&&c<='z') || (c>='A'&&c<='Z') || c==='_'`.
- `isIdentifierPart(c)` → identifier-start set ∪ digits.
- Delete the hyphen branch in `readIdentifier` (the `else if (char === "-" && …)` at ~line 172).
- Update the file header comment ("Kebab-case identifiers" → "C-like identifiers").
- Tests (`src/parse/tests/lexer.test.ts`, `lexer-span.test.ts`): uppercase + `_` lex as one identifier; `A9_b` is one token; `a-b` now lexes as `a`, an `unexpected-character` for `-`, then `b`; arrows `->`/`-->` still tokenize. Remove/replace kebab-tokenization assertions.

### Component 3 — prelude migration (`src/stdlib/prelude.todl` + regenerate)

Recase the prelude to the convention and update the two identifier value-regexes to the C-like charset:

```todl
namespace todl
{
    primitive Identifier : string { regex = "^[A-Za-z_][A-Za-z0-9_]*$"; }
    primitive Slug       : string { regex = "^[a-z0-9]+(?:-[a-z0-9]+)*$"; }   // slug = external hyphenated value, unchanged
    primitive Label      : string { }

    annotation Icon     { path    : string?; }
    annotation Toolbox  { visible : boolean?; }
    annotation Instance { concept : Identifier; via : Identifier?; }

    concept Element
    {
        label       : Label?;
        description : string?;
    }
}
```

Notes: `Slug`'s **value** regex keeps hyphens (slug values are external strings like URL/package slugs — the lexer change only forbids `-` in *identifiers*, not in string contents). `Identifier`'s value regex widens to the C-like charset. Regenerate `prelude.generated.ts` (`npm run gen:prelude`). Update `src/stdlib/tests/prelude.test.ts` id lists to the new names (`Identifier`, `Slug`, `Label`, `Icon`, `Toolbox`, `Instance`, `Element`).

**Compiler-internal hardcoded prelude names — MUST migrate in lockstep** (else resolution breaks silently):
- [loader.ts:333](../../src/parse/loader.ts) hardcodes `"element"` for the implicit-root-supertype rule → `"Element"`.
- [js-module.ts:231](../../src/emit/js-module.ts) hardcodes `"identifier"` and `"slug"` for id-typed value emit → `"Identifier"` / `"Slug"`.
- (Not affected: `js-module.ts:144` `attrs.get("label")` is a member/attribute key — stays lowercase `label`. `hover.ts` `"instance"` is a SymbolKind display label, not the annotation name.)
A `grep` for prelude-name string literals across non-test `src/` at plan time is required to catch any further hardcoded references before publishing.

**Downstream note:** the prelude root concept is now `Element` (was `element`) and the standard annotations are `Icon`/`Toolbox`/`Instance` — SP2 (Plexus corpus/emitters) and any consumer referencing these by name must update.

### Component 4 — `.todl` fixture migration (5 files)

Run the recaser over `src/parse/tests/fixtures/*.todl` (`primitives.todl`, `enums.todl`, `concepts.todl`, `order-fulfillment.todl`) and any test asserting on their content. `enums.todl` exercises hyphenated namespace segments (`meta-models` → `metaModels`) and taxonomy terms → Pascal (`term user` → `term User`).

### Component 5 — test-corpus migration (~170 `.ts` files) [the large, iterative part]

Apply the `.ts` fragment recaser to embedded `.todl` template literals across `src/**/*.test.ts` and any `.ts` carrying inline TODL. Then drive the suite green: run `npx tsx --conditions=development --test "src/**/*.test.ts"`, and for each failure fix either (a) a snippet the recaser mis-classified, or (b) a stale TS assertion string literal (e.g. `expect(id).toBe('app-component')` → `'AppComponent'`) that the recaser deliberately left alone. Repeat until green. This component has an irreducible manual-cleanup tail; the oracle bounds it.

### Component 6 — `codegen/naming.ts`

`pascalCase`/`camelCase` currently split on `-` ([naming.ts:3](../../src/codegen/naming.ts)); their inputs are now already-cased C-like identifiers. Replace `segments` with a case-aware splitter (split on existing case boundaries + any residual `_`), so `camelCase("AppComponent")` → `"appComponent"` and `pascalCase("appComponent")` → `"AppComponent"`. Update `src/codegen/tests/naming.test.ts` inputs/expectations to C-like ids; regenerate/adjust the codegen fixture `tech-catalog.generated.ts` and its test if their input ids changed.

### Component 7 — publish

`npm run build && npm run typecheck`, full suite green, then `npm version minor --no-git-tag-version` (0.18.0 → 0.19.0) + `npm publish` to Verdaccio. This is a **breaking** change (pre-1.0, so a minor bump per the repo's convention); SP2 must republish the Plexus corpus before it will compile.

## Testing strategy

- Recaser: exhaustive unit tests (Component 1) — the classification table is the contract.
- Lexer: token-level tests (Component 2).
- Whole-suite green is the integration gate — the migration is correct iff every existing test (which exercises the compiler on recased snippets and asserts on recased ids) passes.

## Risks & mitigations

- **Recaser misclassification on unusual snippets** → oracle (test suite) catches; manual fix. Rule 7 leaves ambiguous tokens unchanged (fail loud at compile, not silently wrong).
- **Member/type spelling divergence** (`depends-on` → `dependsOn` vs `DependsOn`) handled by position rules 4/5; a global find-replace would be wrong, which is exactly why the recaser is token-context.
- **`.ts` string-literal assertions** the recaser can't safely touch → Component 5 oracle loop.
- **Hyphenated namespace segments** (`meta-models`) → rule 2 camel-de-hyphenation.

## Out of scope (separate sub-projects)

- **SP2:** the Plexus meta-model/library `.todl` corpus (e.g. the microsoft library), the Plexus emitters that *synthesize* kebab ids (slugify → C-like), the `@pragmatic-tech-ai/todl` floor bump, and re-publishing bases. Reuses this recaser.
- **SP3:** the parked mural-resource-keys feature — resume with `MuralResource`/`Key`/`ResourceKey` now legal (the spec/plan already exist under `Plexus/docs/superpowers/`).
- No additive/back-compat kebab support (deliberate hard cutover).
