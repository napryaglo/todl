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
