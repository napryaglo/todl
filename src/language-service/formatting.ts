import type { TextEdit, Range } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";

const INDENT = "  ";

// Re-indent each line by its brace depth, trim trailing whitespace, and collapse
// runs of blank lines to one. Only `{`/`}` outside strings and comments drive
// depth, so cardinality `[]` and braces inside literals/comments are inert.
export function formatText(text: string): string {
  const lines = text.split("\n");
  const hadTrailingNewline = text.endsWith("\n");
  if (hadTrailingNewline) lines.pop();   // drop the empty element after the last "\n"

  const out: string[] = [];
  let depth = 0;
  let blankRun = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === "") { blankRun += 1; if (blankRun <= 1) out.push(""); continue; }
    blankRun = 0;
    const startsClosing = trimmed.startsWith("}");
    const indentDepth = Math.max(0, depth - (startsClosing ? 1 : 0));
    out.push(INDENT.repeat(indentDepth) + trimmed);
    depth = Math.max(0, depth + braceDelta(trimmed));
  }

  return out.join("\n") + (hadTrailingNewline ? "\n" : "");
}

export function formatDocument(a: Analysis, uri: string): TextEdit[] {
  const file = a.sources.get(uri);
  if (file === undefined) return [];
  const formatted = formatText(file.text);
  if (formatted === file.text) return [];
  return [{ range: fullRange(file.text), newText: formatted }];
}

// Net `{` minus `}` on a line, ignoring braces inside "…"/`//`/`/* */`.
function braceDelta(line: string): number {
  let delta = 0;
  let i = 0;
  let inString = false;
  while (i < line.length) {
    const ch = line[i]!;
    if (inString) {
      if (ch === '"') inString = false;
      i += 1; continue;
    }
    if (ch === '"') { inString = true; i += 1; continue; }
    if (ch === "/" && line[i + 1] === "/") break;                 // line comment — rest ignored
    if (ch === "/" && line[i + 1] === "*") {                      // block comment — skip to */
      const end = line.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 2; continue;
    }
    if (ch === "{") delta += 1;
    else if (ch === "}") delta -= 1;
    i += 1;
  }
  return delta;
}

function fullRange(text: string): Range {
  const lines = text.split("\n");
  const last = lines.length - 1;
  return { start: { line: 0, character: 0 }, end: { line: last, character: lines[last]!.length } };
}
