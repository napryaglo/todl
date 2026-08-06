# TODL C-like Identifiers Implementation Plan (SP1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut TODL's identifier grammar over from kebab-case to C-like (`[A-Za-z_][A-Za-z0-9_]*`), migrate TODL's entire own corpus to PascalCase-types/camelCase-members with a reusable grammar-aware recaser, and publish 0.19.0.

**Architecture:** Build a self-contained grammar-aware recaser (its own kebab scanner, independent of the live lexer so it survives the cutover), plus a harness that recases `.todl` fragments embedded in `.ts` test files. Then perform one atomic migration: recase prelude + fixtures + tests, flip the lexer, fix the compiler's hardcoded prelude-name literals, and drive the test suite (the migration oracle) to green.

**Tech Stack:** TypeScript (ESM, strict — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `node:test` via `tsx`, Verdaccio local registry.

## Global Constraints

- Local registry is Verdaccio at `http://localhost:4873/`.
- Casing convention: **user-defined types → PascalCase** (concept, user primitive, taxonomy, relationship, annotation, model, enum, term — declarations and references); **members → camelCase** (fields, relationship member-names, annotation params); **built-in primitives `string`/`number`/`boolean` stay lowercase**; **namespaces/package ids stay lowercase** (multi-word segments → lowercase-first camel, e.g. `meta-models` → `metaModels`); **identifier-valued string attributes follow their referent**.
- Identifier grammar after cutover: `[A-Za-z_][A-Za-z0-9_]*`. Hyphen removed from identifiers entirely; a stray `-` (outside `->`/`-->`) is `unexpected character`.
- The recaser must NOT import `src/parse/lexer.ts` — it carries its own kebab scanner so its tests stay green after the lexer flips.
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- Test runner: `npx tsx --conditions=development --test "src/**/*.test.ts"`. Typecheck: `npm run typecheck`. Build: `npm run build`. Prelude regen: `npm run gen:prelude`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Work on a fresh branch off TODL `main` (`feat/c-like-identifiers`); commit per task; do not push/merge until the finishing gate.

**Key facts:**
- Lexer identifier rules live at `src/parse/lexer.ts`: `isIdentifierStart` (line ~285, `a-z` only), `isIdentifierPart` (line ~289, `a-z`+`0-9`), and a hyphen branch in `readIdentifier` (line ~172). Arrows `->`/`-->` are matched earlier (lines ~137/140) and are unaffected.
- Compiler hardcodes prelude names: `src/parse/loader.ts:333` uses `"element"`; `src/emit/js-module.ts:231` uses `"identifier"` and `"slug"`. (`js-module.ts:144` `attrs.get("label")` is a member key — stays lowercase.)
- Only 5 `.todl` files exist (`src/parse/tests/fixtures/*.todl` + `src/stdlib/prelude.todl`); the rest of the corpus is inline `.todl` inside `.ts` test files.
- `codegen/naming.ts` `pascalCase`/`camelCase` split on `-` and must become case-aware.

---

### Task 1: The recaser core (`src/migrate/recase.ts`)

**Files:**
- Create: `src/migrate/recase.ts`
- Test: `src/migrate/tests/recase.test.ts`

**Interfaces:**
- Consumes: nothing (self-contained scanner).
- Produces: `recaseSource(text: string): string` — recases TODL source text per the convention. Also exports `toPascal(id: string): string`, `toCamel(id: string): string`, `toLowerCamel(id: string): string` (word-splitting on `-`, `_`, and case boundaries; idempotent).

- [ ] **Step 1: Write failing casing-helper tests**

Create `src/migrate/tests/recase.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { recaseSource, toPascal, toCamel, toLowerCamel } from "../recase.js";

test("casing helpers split on -, _, and case boundaries (idempotent)", () => {
  assert.equal(toPascal("app-component"), "AppComponent");
  assert.equal(toPascal("AppComponent"), "AppComponent");
  assert.equal(toCamel("hosted-by"), "hostedBy");
  assert.equal(toCamel("HostedBy"), "hostedBy");
  assert.equal(toLowerCamel("meta-models"), "metaModels");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test "src/migrate/tests/recase.test.ts"`
Expected: FAIL — `../recase.js` does not exist.

- [ ] **Step 3: Implement the casing helpers (recaseSource stubbed)**

Create `src/migrate/recase.ts`:

```ts
/**
 * Grammar-aware kebab → C-like identifier recaser (SP1). Self-contained: it has
 * its own kebab-capable scanner so it does NOT depend on src/parse/lexer.ts and
 * keeps working after the lexer is flipped to C-like. Pure string → string.
 *
 * Convention: user-defined TYPES → PascalCase; MEMBERS → camelCase; built-in
 * string/number/boolean stay lowercase; namespaces stay lowercase (multi-word →
 * lowercase-first camel). See docs/superpowers/specs/2026-08-06-todl-c-like-identifiers-design.md.
 */

// ── word splitting + casing ──────────────────────────────────────────────────
function words(id: string): string[] {
  // split on - and _, then on lower→UPPER and UPPER-run→Upper+lower boundaries
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}
function cap(w: string): string { return w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1); }
export function toPascal(id: string): string { return words(id).map(cap).join(""); }
export function toCamel(id: string): string {
  const ws = words(id);
  return ws.length === 0 ? "" : ws[0]! + ws.slice(1).map(cap).join("");
}
export const toLowerCamel = toCamel; // namespaces: lowercase-first, same shape as camel

// Real implementation lands in Step 7; stub keeps the test module importable now.
export function recaseSource(text: string): string { return text; }
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `npx tsx --conditions=development --test "src/migrate/tests/recase.test.ts" -t "casing helpers"`
Expected: PASS.

- [ ] **Step 5: Write failing classification tests**

Append to `src/migrate/tests/recase.test.ts`:

```ts
test("recases a concept declaration, supertype, and member/type divergence", () => {
  const out = recaseSource(`concept app-component : component { hosted-by : technology; depends-on : depends-on; }`);
  assert.equal(out, `concept AppComponent : Component { hostedBy : Technology; dependsOn : DependsOn; }`);
});

test("leaves built-in primitives lowercase, recases user primitives", () => {
  assert.equal(recaseSource(`primitive resource-key : string { }`), `primitive ResourceKey : string { }`);
  assert.equal(recaseSource(`label : string?;`), `label : string?;`);
  assert.equal(recaseSource(`weight : number;`), `weight : number;`);
});

test("recases taxonomy, represents, and terms; keeps namespaces lowercase", () => {
  const out = recaseSource(`namespace adl.meta-models.bpmn { taxonomy task-type : represents task { term user { label = "User"; } } }`);
  assert.equal(out, `namespace adl.metaModels.bpmn { taxonomy TaskType : represents Task { term User { label = "User"; } } }`);
});

test("recases annotation decl + application; identifier-valued string follows referent", () => {
  assert.equal(recaseSource(`annotation my-badge { path : string; }`), `annotation MyBadge { path : string; }`);
  assert.equal(recaseSource(`annotate my-badge { path = "x"; }`), `annotate MyBadge { path = "x"; }`);
  assert.equal(recaseSource(`annotate instance { concept = "app-component"; }`), `annotate Instance { concept = "AppComponent"; }`);
});

test("recases relationship declaration and arrow target", () => {
  assert.equal(recaseSource(`relationship depends-on -> app-component;`), `relationship DependsOn -> AppComponent;`);
});
```

- [ ] **Step 6: Run to verify the classification tests fail**

Run: `npx tsx --conditions=development --test "src/migrate/tests/recase.test.ts"`
Expected: FAIL — `recaseSource` not implemented.

- [ ] **Step 7: Implement the scanner, classification, and real `recaseSource`**

In `src/migrate/recase.ts`, **delete the stub** `recaseSource` from Step 3 and append the scanner + classifier + real implementation:

```ts
// ── minimal self-contained scanner ───────────────────────────────────────────
enum K { Ident = "ident", Punct = "punct", String = "string", Other = "other" }
interface Tok { kind: K; text: string; start: number; end: number }

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

function scan(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      const start = i; i += 3; while (i < n && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) i++; i += 3;
      toks.push({ kind: K.String, text: src.slice(start, i), start, end: i }); continue;
    }
    if (c === '"') {
      const start = i; i++; while (i < n && src[i] !== '"') { if (src[i] === "\\") i++; i++; } i++;
      toks.push({ kind: K.String, text: src.slice(start, i), start, end: i }); continue;
    }
    if (IDENT_START.test(c)) {
      const start = i; i++;
      for (;;) {
        if (i < n && IDENT_PART.test(src[i]!)) { i++; continue; }
        if (i < n && src[i] === "-" && i + 1 < n && IDENT_PART.test(src[i + 1]!)) { i += 2; continue; }
        break;
      }
      toks.push({ kind: K.Ident, text: src.slice(start, i), start, end: i }); continue;
    }
    if (c === "-" && src[i + 1] === "-" && src[i + 2] === ">") { toks.push({ kind: K.Punct, text: "-->", start: i, end: i + 3 }); i += 3; continue; }
    if (c === "-" && src[i + 1] === ">") { toks.push({ kind: K.Punct, text: "->", start: i, end: i + 2 }); i += 2; continue; }
    toks.push({ kind: (":.={};[]()<>,?+*|&!".includes(c) ? K.Punct : K.Other), text: c, start: i, end: i + 1 });
    i++;
  }
  return toks;
}

// ── classification + rewrite ─────────────────────────────────────────────────
const TYPE_DECL_KW = new Set(["concept", "primitive", "taxonomy", "annotation", "relationship", "model", "enum", "term"]);
const TYPE_REF_PREV = new Set([":", "represents", "uses", "annotate", "->", "-->"]);
const NS_KW = new Set(["namespace", "package"]);
const BUILTIN = new Set(["string", "number", "boolean"]);
const ID_VALUE_KEYS = new Set(["concept", "via"]); // params whose string value denotes an identifier
const KEBAB_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
// Every reserved word — never recased, even in type/member position (`represents`
// after `:`, a param literally named `concept`, etc.). A `term`/`concept` token
// here is the keyword; the NAME after it still classifies via its `prev`.
const KEYWORDS = new Set([...TYPE_DECL_KW, ...NS_KW, ...BUILTIN, "represents", "uses", "annotate", "true", "false"]);

enum Role { TypePascal, MemberCamel, NamespaceLower, Unchanged }

export function recaseSource(text: string): string {
  const toks = scan(text);
  // mark which idents are inside a `namespace <dotted>` header (until the next `{`)
  const inNs = new Array<boolean>(toks.length).fill(false);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]!.kind === K.Ident && toks[i]!.text === "namespace") {
      for (let j = i + 1; j < toks.length; j++) {
        if (toks[j]!.kind === K.Punct && toks[j]!.text === "{") break;
        inNs[j] = true;
      }
    }
  }
  const repl: Array<{ start: number; end: number; text: string }> = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (t.kind === K.String) {
      // identifier-valued string: `<key> = "kebab"` with key in the allowlist
      if (prev?.text === "=" && toks[i - 2]?.kind === K.Ident && ID_VALUE_KEYS.has((toks[i - 2]!.text).toLowerCase())) {
        const inner = t.text.slice(1, -1);
        if (KEBAB_ID.test(inner)) repl.push({ start: t.start, end: t.end, text: `"${toPascal(inner)}"` });
      }
      continue;
    }
    if (t.kind !== K.Ident) continue;
    const role = classify(t, prev, next, inNs[i] === true);
    const cased = apply(t.text, role);
    if (cased !== t.text) repl.push({ start: t.start, end: t.end, text: cased });
  }
  let out = ""; let pos = 0;
  for (const r of repl) { out += text.slice(pos, r.start) + r.text; pos = r.end; }
  return out + text.slice(pos);
}

function classify(t: Tok, prev: Tok | undefined, next: Tok | undefined, inNamespace: boolean): Role {
  if (KEYWORDS.has(t.text)) return Role.Unchanged;                    // reserved word — never recased
  if (inNamespace) return Role.NamespaceLower;                        // segment of a namespace header
  if (prev !== undefined && prev.kind === K.Ident && TYPE_DECL_KW.has(prev.text)) return Role.TypePascal;
  if (prev !== undefined && TYPE_REF_PREV.has(prev.text)) return Role.TypePascal;
  if (next !== undefined && (next.text === ":" || next.text === "=")) return Role.MemberCamel;
  return Role.Unchanged;
}

function apply(id: string, role: Role): string {
  switch (role) {
    case Role.TypePascal: return toPascal(id);
    case Role.MemberCamel: return toCamel(id);
    case Role.NamespaceLower: return id.includes("-") ? toLowerCamel(id) : id;
    default: return id;
  }
}
```

- [ ] **Step 8: Run the full recaser test file to verify it passes**

Run: `npx tsx --conditions=development --test "src/migrate/tests/recase.test.ts"`
Expected: PASS — all recaser tests green.

- [ ] **Step 9: Commit**

```bash
git add src/migrate/recase.ts src/migrate/tests/recase.test.ts
git commit -m "$(cat <<'EOF'
feat(migrate): grammar-aware kebab→C-like identifier recaser

Self-contained scanner (independent of parse/lexer) + token-context classifier:
types→Pascal, members→camel, built-ins/namespaces lowercase, id-valued strings
follow referent. Reusable for the Plexus corpus (SP2).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `.ts` embedded-fragment harness (`src/migrate/recase-ts.ts`)

**Files:**
- Create: `src/migrate/recase-ts.ts`
- Test: `src/migrate/tests/recase-ts.test.ts`

**Interfaces:**
- Consumes: `recaseSource` from Task 1.
- Produces: `recaseTsFragments(tsSource: string): string` — recases the `.todl` content of every backtick template literal that looks like TODL, leaving all other TS text untouched.

- [ ] **Step 1: Write the failing test**

Create `src/migrate/tests/recase-ts.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { recaseTsFragments } from "../recase-ts.js";

test("recases .todl inside backtick literals, leaves other TS untouched", () => {
  const ts = [
    "const src = `namespace app { concept app-component : component { } }`;",
    "const other = `just a plain string with app-component`;", // no TODL keyword → untouched
    "expect(id).toBe('app-component');",                        // single-quote assertion → untouched (oracle handles)
  ].join("\n");
  const out = recaseTsFragments(ts);
  assert.match(out, /concept AppComponent : Component/);
  assert.match(out, /just a plain string with app-component/); // unchanged
  assert.match(out, /toBe\('app-component'\)/);                 // unchanged
});

test("passes through ${...} interpolations, recasing only literal chunks", () => {
  const ts = "const s = `concept app-component { x : ${t}; }`;";
  const out = recaseTsFragments(ts);
  assert.match(out, /concept AppComponent \{ x : \$\{t\}; \}/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test "src/migrate/tests/recase-ts.test.ts"`
Expected: FAIL — `../recase-ts.js` does not exist.

- [ ] **Step 3: Implement the harness**

Create `src/migrate/recase-ts.ts`:

```ts
/** Recase .todl fragments embedded in backtick template literals within a .ts file. */
import { recaseSource } from "./recase.js";

const TODL_KW = /\b(namespace|concept|taxonomy|annotation|annotate|relationship|primitive|model|term|represents|enum|uses)\b/;

// Recase one template-literal body: split on ${...}, recase the literal chunks only.
function recaseTemplateBody(body: string): string {
  if (!TODL_KW.test(body)) return body;
  const parts = body.split(/(\$\{[^}]*\})/); // keep interpolations as separators
  return parts.map((p) => (p.startsWith("${") ? p : recaseSource(p))).join("");
}

export function recaseTsFragments(tsSource: string): string {
  let out = "";
  let i = 0;
  const n = tsSource.length;
  while (i < n) {
    const c = tsSource[i]!;
    if (c === "`") {
      const start = i + 1;
      let j = start;
      while (j < n && tsSource[j] !== "`") { if (tsSource[j] === "\\") j++; j++; }
      out += "`" + recaseTemplateBody(tsSource.slice(start, j)) + "`";
      i = j + 1;
      continue;
    }
    // skip normal single/double-quoted strings verbatim so we never touch them
    if (c === "'" || c === '"') {
      const q = c; let j = i + 1;
      while (j < n && tsSource[j] !== q) { if (tsSource[j] === "\\") j++; j++; }
      out += tsSource.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test "src/migrate/tests/recase-ts.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/migrate/recase-ts.ts src/migrate/tests/recase-ts.test.ts
git commit -m "$(cat <<'EOF'
feat(migrate): recase .todl fragments embedded in .ts test files

recaseTsFragments recases backtick template literals containing TODL keywords,
passing through ${} interpolations and never touching '/"-quoted TS strings.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Case-aware `codegen/naming.ts`

**Files:**
- Modify: `src/codegen/naming.ts`
- Modify: `src/codegen/tests/naming.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pascalCase(id)`/`camelCase(id)` that split on `-`, `_`, and case boundaries (idempotent for already-C-like input).

- [ ] **Step 1: Update the failing tests for C-like inputs**

In `src/codegen/tests/naming.test.ts`, replace the `pascalCase`/`camelCase` tests with cases that also cover already-cased input:

```ts
test("pascalCase splits kebab/underscore/case boundaries and capitalizes each", () => {
  assert.equal(pascalCase("component"), "Component");
  assert.equal(pascalCase("app-component"), "AppComponent");
  assert.equal(pascalCase("AppComponent"), "AppComponent"); // idempotent
  assert.equal(pascalCase("appComponent"), "AppComponent");
});

test("camelCase lowercases the first word, capitalizes the rest", () => {
  assert.equal(camelCase("label"), "label");
  assert.equal(camelCase("implemented-by"), "implementedBy");
  assert.equal(camelCase("ImplementedBy"), "implementedBy"); // idempotent
  assert.equal(camelCase("implementedBy"), "implementedBy");
});
```

Also change the `allocateNames` collision test's ids to C-like: `allocateNames(["AppComponent", "Technology"], pascalCase)` and the collision pair to `["chatSurface", "chat-surface"]` (both → `ChatSurface`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test "src/codegen/tests/naming.test.ts"`
Expected: FAIL — `camelCase("ImplementedBy")` currently returns `"ImplementedBy"` (splits only on `-`).

- [ ] **Step 3: Replace `segments` with a case-aware splitter**

In `src/codegen/naming.ts`, replace the `segments` function:

```ts
function segments(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}
```

(`pascalCase`/`camelCase`/`pluralize`/`allocateNames` stay as-is; they now receive lowercased word arrays regardless of input casing.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test "src/codegen/tests/naming.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codegen/naming.ts src/codegen/tests/naming.test.ts
git commit -m "$(cat <<'EOF'
refactor(codegen): case-aware identifier splitter in naming.ts

Split on -, _, and case boundaries so pascalCase/camelCase are idempotent on the
new C-like identifiers (and still handle kebab during migration).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Atomic migration — recase corpus, flip lexer, fix hardcoded literals, drive suite green

This task has an unavoidable red window: the lexer flip and prelude rename break every not-yet-recased reference at once, so the deliverable is the **whole suite green at the end**, not incremental greens. Run tools first, then iterate against the oracle.

**Files:**
- Modify: `src/parse/lexer.ts`
- Modify: `src/stdlib/prelude.todl`, `src/stdlib/prelude.generated.ts` (regenerated), `src/stdlib/tests/prelude.test.ts`
- Modify: `src/parse/loader.ts:333`, `src/emit/js-module.ts:231`
- Modify: `src/parse/tests/fixtures/*.todl` (5 files) and every `src/**/*.test.ts` with inline TODL
- Modify: `src/parse/tests/lexer.test.ts`

- [ ] **Step 1: Recase the `.todl` fixtures and prelude**

Run a one-off script (via `tsx`) that reads each `.todl` file, applies `recaseSource`, and writes it back:

```bash
npx tsx -e '
import { readFileSync, writeFileSync } from "node:fs";
import { recaseSource } from "./src/migrate/recase.ts";
for (const f of ["src/stdlib/prelude.todl","src/parse/tests/fixtures/primitives.todl","src/parse/tests/fixtures/enums.todl","src/parse/tests/fixtures/concepts.todl","src/parse/tests/fixtures/order-fulfillment.todl"])
  writeFileSync(f, recaseSource(readFileSync(f,"utf8")));
'
```

Then hand-fix the prelude's `Identifier` value-regex (the recaser does not touch regex string contents): open `src/stdlib/prelude.todl` and set `primitive Identifier : string { regex = "^[A-Za-z_][A-Za-z0-9_]*$"; }`. Confirm `Slug`'s regex is unchanged (keeps hyphens) and `string` stayed lowercase in field types.

- [ ] **Step 2: Recase all `.ts` files with inline TODL**

```bash
npx tsx -e '
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { recaseTsFragments } from "./src/migrate/recase-ts.ts";
const files = execSync("git ls-files src",{encoding:"utf8"}).split("\n").filter((f) => f.endsWith(".ts"));
for (const f of files) {
  // Skip all of src/migrate/: the recaser + legacy rewriter + their tests hold
  // kebab identifiers AS DATA (keyword sets, regexes, legacy-surface fixtures).
  if (f.startsWith("src/migrate/")) continue;
  const before = readFileSync(f,"utf8");
  const after = recaseTsFragments(before);
  if (after !== before) writeFileSync(f, after);
}
'
```

Note: skipping `src/migrate/` means the legacy `rewriter.test.ts` keeps its kebab fixtures. If, after the lexer flip, any `src/migrate/` test that *compiles* its output fails (the legacy `rewrite()` emits kebab, now invalid), handle it in the Step 6 oracle loop — either chain `recaseSource` onto `rewrite()`'s output or update that test's expectation. Do not bulk-recase the migrate directory.

- [ ] **Step 3: Flip the lexer to C-like**

In `src/parse/lexer.ts`:
- `isIdentifierStart`: `return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";`
- `isIdentifierPart`: `return isIdentifierStart(char) || (char >= "0" && char <= "9");`
- Delete the hyphen branch in `readIdentifier` (`else if (char === "-" && isIdentifierPart(this.peek(1)))` and its two `advance()` calls).
- Update the header comment line 3 from "Kebab-case identifiers" to "C-like identifiers (`[A-Za-z_][A-Za-z0-9_]*`)".

- [ ] **Step 4: Fix the compiler's hardcoded prelude-name literals**

- `src/parse/loader.ts:333` — change `"element"` (both occurrences on that line) to `"Element"`.
- `src/emit/js-module.ts:231` — change `type !== "identifier" && type !== "slug"` to `type !== "Identifier" && type !== "Slug"`.
- Grep for any others: `grep -rnE '"(element|identifier|slug|label|icon|toolbox|instance)"' src --include=*.ts | grep -v tests` and migrate any genuine prelude-name reference found (leave member/attribute keys like `attrs.get("label")` lowercase).

- [ ] **Step 5: Regenerate the prelude and update lexer/prelude tests**

- Run: `npm run gen:prelude` (syncs `prelude.generated.ts`).
- In `src/stdlib/tests/prelude.test.ts`, change the id lists to `["Identifier","Slug","Label","Icon","Toolbox","Instance","Element"]`.
- In `src/parse/tests/lexer.test.ts`: replace the kebab-specific tests — the "keeps hyphenated identifiers whole" test (line ~48) becomes a test that `sequence-flow` now lexes as `[Identifier "sequence", <unexpected '-'>, Identifier "flow"]` via `lex()`; recase the `sequence-flow`/`lives-in` literals in the other tests to `sequenceFlow`/`livesIn`; add a test that `AppComponent` and `a_b9` each lex as a single Identifier.

- [ ] **Step 6: Run the full suite; iterate to green (oracle loop)**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts" 2>&1 | tail -60`

For each failure, apply exactly one of:
- **Recaser miss** in a `.todl` fragment (rare ambiguous position) → fix the snippet by hand to the correct casing.
- **Stale assertion string** — a single/double-quoted TS literal holding an id the recaser deliberately left alone (e.g. `expect(node.id).toBe('app-component')` → `'AppComponent'`, `schemaOf("technology")` → `schemaOf("Technology")`). Recase it to match its declaration.
- **Fixture drift** — a test asserting on recased fixture content that itself needs its expected string recased.

Re-run after each batch. Commit in reviewable batches by directory as they green, e.g.:

```bash
git add src/parse && git commit -m "$(printf 'migrate(parse): recase corpus to C-like identifiers\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

Continue until `npx tsx --conditions=development --test "src/**/*.test.ts"` reports zero failures.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors. Fix any type-level fallout (e.g. a codegen fixture `tech-catalog.generated.ts` whose generated names shifted — regenerate or hand-align it and its test).

- [ ] **Step 8: Final commit for any remaining migrated files**

```bash
git add -A && git commit -m "$(cat <<'EOF'
migrate: complete C-like identifier cutover across TODL corpus

Flip lexer to C-like, recase prelude/fixtures/tests, fix hardcoded prelude-name
literals (element/identifier/slug), regenerate prelude. Full suite green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Build, typecheck, publish 0.19.0

**Files:**
- Modify: `package.json` (version bump by `npm version`)

- [ ] **Step 1: Full green gate**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts" && npm run typecheck && npm run build`
Expected: suite green, no type errors, build succeeds.

- [ ] **Step 2: Bump + publish to Verdaccio**

Run: `npm version minor --no-git-tag-version && npm publish`
Expected: `@pragmatic-lab/todl@0.19.0` published to `http://localhost:4873/`. (Breaking change; pre-1.0 minor per repo convention. SP2 will republish the Plexus corpus against it.)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore(release): @pragmatic-lab/todl 0.19.0 — C-like identifiers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the executor

- **The recaser must never be recased.** Steps in Task 4 explicitly skip `src/migrate/recase.ts`, `recase-ts.ts`, and their tests — those hold kebab literals *as data* (keyword sets, regexes, test fixtures) and must not be rewritten.
- **The oracle is the contract.** Task 4's correctness = the full suite passing. A recaser miss surfaces as a specific test failure with a specific id; fix that id. Do not broaden the recaser mid-migration unless a failure class is systematic.
- **Red window is expected** in Task 4 between the lexer flip and full green — that is inherent to a disjoint-grammar cutover, and is contained to the feature branch.
- **Deferred (separate sub-projects):** SP2 — Plexus meta-model/library `.todl` corpus + emitters that synthesize kebab ids + `@pragmatic-lab/todl` floor bump + republish (reuses this recaser). SP3 — resume mural-resource-keys with PascalCase names (`Plexus/docs/superpowers/` spec+plan already exist).
```
