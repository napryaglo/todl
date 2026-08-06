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
