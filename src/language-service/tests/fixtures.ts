import type { Position } from "vscode-languageserver-types";
import { analyze, type Analysis } from "../analysis.js";

const MARKER = "‸";

// Parse a marked source: every `‸` records a 0-based LSP Position (in order) and
// is removed from the text; the cleaned text is analyzed as a single-file project.
export function fixture(uri: string, marked: string): { analysis: Analysis; positions: Position[]; uri: string } {
  const positions: Position[] = [];
  let line = 0, character = 0, text = "";
  for (const ch of marked) {
    if (ch === MARKER) { positions.push({ line, character }); continue; }
    text += ch;
    if (ch === "\n") { line += 1; character = 0; } else { character += 1; }
  }
  return { analysis: analyze([{ uri, text }]), positions, uri };
}
