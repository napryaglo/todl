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
const TYPE_DECL_KW = new Set(["concept", "primitive", "taxonomy", "annotation", "model", "enum", "term"]);
const MEMBER_DECL_KW = new Set(["relationship"]); // `relationship <name>` — name is a MEMBER
const TYPE_REF_PREV = new Set([":", "represents", "uses", "annotate", "class", "->", "-->"]);
const NS_KW = new Set(["namespace", "package"]);
const BUILTIN = new Set(["string", "number", "boolean"]);
const VALUE_PREV = new Set(["=", "[", ","]); // reference-value positions
const ID_VALUE_KEYS = new Set(["concept", "via"]); // params whose string value denotes an identifier
const KEBAB_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
// Every reserved word — TODL keywords are ALL lowercase and are never recased,
// even in type/member position (`represents` after `:`, a param literally named
// `concept`, `class`/`import` at statement start, etc.).
const KEYWORDS = new Set([
  ...TYPE_DECL_KW, ...MEMBER_DECL_KW, ...NS_KW, ...BUILTIN,
  "import", "class", "instanceof", "represents", "uses", "annotate", "extends", "implies", "true", "false",
]);

enum Role { TypePascal, MemberCamel, NamespaceLower, InstanceCamel, Unchanged }

function isStmtBoundary(t: Tok | undefined): boolean {
  return t === undefined || (t.kind === K.Punct && (t.text === "{" || t.text === "}" || t.text === ";"));
}

// Classify every token of `text`, returning the token stream and each token's Role.
function analyze(text: string): { toks: Tok[]; roles: Role[] } {
  const toks = scan(text);
  const n = toks.length;
  const roles = new Array<Role>(n).fill(Role.Unchanged);
  const handled = new Array<boolean>(n).fill(false);

  // 1. idents inside a `namespace <dotted>` header (until the next `{`).
  const inNs = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (toks[i]!.kind === K.Ident && toks[i]!.text === "namespace") {
      for (let j = i + 1; j < n; j++) { if (toks[j]!.kind === K.Punct && toks[j]!.text === "{") break; inNs[j] = true; }
    }
  }

  // 2. dotted runs `ident ('.' ident)+` — role depends on the head's context.
  for (let i = 0; i < n; i++) {
    if (toks[i]!.kind !== K.Ident || handled[i]) continue;
    if (!(toks[i + 1]?.text === "." && toks[i + 2]?.kind === K.Ident)) continue;
    const seg: number[] = [i];
    let j = i + 1;
    while (toks[j]?.text === "." && toks[j + 1]?.kind === K.Ident) { seg.push(j + 1); j += 2; }
    const before = toks[i - 1];
    const head = toks[i]!.text;
    let roleAt: (pos: number, last: boolean) => Role;
    if (head === "this" || head === "This") roleAt = (pos) => (pos === 0 ? Role.Unchanged : Role.MemberCamel); // this.member (even in value position)
    else if (inNs[i]) roleAt = () => Role.NamespaceLower;
    else if (before !== undefined && VALUE_PREV.has(before.text)) roleAt = () => Role.TypePascal;         // taxonomy.term value
    else if (before !== undefined && (TYPE_REF_PREV.has(before.text) || before.text === "import")) roleAt = (_p, last) => (last ? Role.TypePascal : Role.NamespaceLower); // ns.Type / import ns.Symbol
    else roleAt = () => Role.Unchanged;
    seg.forEach((idx, pos) => { roles[idx] = roleAt(pos, pos === seg.length - 1); handled[idx] = true; });
  }

  // Bracket depth per token: a `,` at depth 0 separates a TYPE list
  // (`represents A, B` / `uses A, B`); a `,` inside `[ … ]` separates VALUES.
  const depth = new Array<number>(n).fill(0);
  let d = 0;
  for (let i = 0; i < n; i++) {
    if (toks[i]!.text === "[") { depth[i] = d; d++; }
    else if (toks[i]!.text === "]") { d = Math.max(0, d - 1); depth[i] = d; }
    else depth[i] = d;
  }

  // 3. single (non-dotted) idents.
  for (let i = 0; i < n; i++) {
    if (toks[i]!.kind !== K.Ident || handled[i]) continue;
    roles[i] = classifySingle(toks[i]!, toks[i - 1], toks[i + 1], inNs[i] === true, depth[i] === 0);
    handled[i] = true;
  }
  return { toks, roles };
}

export function recaseSource(text: string): string {
  const { toks, roles } = analyze(text);
  // build replacements (idents by role + identifier-valued string attrs).
  const repl: Array<{ start: number; end: number; text: string }> = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.kind === K.String) {
      const prev = toks[i - 1]; const pp = toks[i - 2];
      if (prev?.text === "=" && pp?.kind === K.Ident && ID_VALUE_KEYS.has(pp.text.toLowerCase())) {
        const inner = t.text.slice(1, -1);
        if (KEBAB_ID.test(inner)) repl.push({ start: t.start, end: t.end, text: `"${toPascal(inner)}"` });
      }
      continue;
    }
    if (t.kind !== K.Ident) continue;
    const cased = apply(t.text, roles[i]!);
    if (cased !== t.text) repl.push({ start: t.start, end: t.end, text: cased });
  }
  let out = ""; let pos = 0;
  for (const r of repl) { out += text.slice(pos, r.start) + r.text; pos = r.end; }
  return out + text.slice(pos);
}

// Record every identifier rename (kebab → new casing) the recaser makes over
// `text` into `into`, keyed by the original token. Feeds a global map for fixing
// TS assertion-string literals that hold ids the recaser can't see in context.
export function collectRenames(text: string, into: Map<string, string>): void {
  const { toks, roles } = analyze(text);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.kind !== K.Ident) continue;
    const cased = apply(t.text, roles[i]!);
    if (cased !== t.text) into.set(t.text, cased);
  }
}

function classifySingle(t: Tok, prev: Tok | undefined, next: Tok | undefined, inNamespace: boolean, atTopLevel: boolean): Role {
  if (KEYWORDS.has(t.text)) return Role.Unchanged;                                          // reserved word
  if (inNamespace) return Role.NamespaceLower;
  if (prev?.kind === K.Ident && MEMBER_DECL_KW.has(prev.text)) return Role.MemberCamel;      // `relationship <name>`
  if (prev?.kind === K.Ident && TYPE_DECL_KW.has(prev.text)) return Role.TypePascal;         // decl name
  if (prev !== undefined && TYPE_REF_PREV.has(prev.text)) return Role.TypePascal;            // type reference
  if (prev?.text === "," && atTopLevel) return Role.TypePascal;                              // `represents A, B` — type list
  if (isStmtBoundary(prev) && next?.kind === K.Ident) return Role.TypePascal;                // `Type id {` — the TYPE
  if (prev?.kind === K.Ident && next?.text === "{") return Role.InstanceCamel;               // `Type id {` — the ID
  if (next !== undefined && (next.text === ":" || next.text === "=")) return Role.MemberCamel; // member/attr key
  if (prev !== undefined && VALUE_PREV.has(prev.text)) return Role.InstanceCamel;            // bare reference value ( = / [ / , inside [] )
  return Role.Unchanged;
}

function apply(id: string, role: Role): string {
  switch (role) {
    case Role.TypePascal: return toPascal(id);
    case Role.MemberCamel: return toCamel(id);
    case Role.InstanceCamel: return toCamel(id);
    case Role.NamespaceLower: return id.includes("-") ? toLowerCamel(id) : id;
    default: return id;
  }
}
