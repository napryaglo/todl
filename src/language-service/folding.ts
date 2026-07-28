import { TokenKind, type Token } from "../parse/lexer.js";
import type { FoldingRange } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";

// One folding range per multi-line `{ … }` block. `endLine` is the last line the
// fold hides — the line before the closing brace — so the brace line stays
// visible when collapsed (the common editor convention).
export function foldingRanges(a: Analysis, uri: string): FoldingRange[] {
  const tokens = a.sources.get(uri)?.tokens ?? [];
  const opens: Token[] = [];
  const ranges: FoldingRange[] = [];
  for (const t of tokens) {
    if (t.kind === TokenKind.LBrace) opens.push(t);
    else if (t.kind === TokenKind.RBrace) {
      const open = opens.pop();
      if (open === undefined) continue;
      const startLine = open.line - 1;      // 0-based
      const endLine = t.line - 1 - 1;       // line before the closing brace
      if (endLine > startLine) ranges.push({ startLine, endLine });
    }
  }
  return ranges;
}
