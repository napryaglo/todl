import type { Position } from "vscode-languageserver-types";
import { TokenKind, type Token } from "../parse/lexer.js";
import type { Analysis } from "./analysis.js";
import { positionToTodl } from "./position.js";

// A cursor's classified role. Reference occurrences resolve to `Identifier`
// (carrying the symbol); empty slots after a syntactic cue (`:`, `->`, `&`)
// classify by what the grammar expects there.
export enum ContextKind {
  TypeSlot, RelationshipTarget, AssignmentName, RefValue, ImportPath, KeywordSlot, Identifier, None,
}

export interface CursorContext {
  kind: ContextKind;
  word: string;
  symbol?: string;
  ownerConcept?: string;
}

export function classifyPosition(a: Analysis, uri: string, pos: Position): CursorContext {
  const file = a.sources.get(uri);
  if (file === undefined) return { kind: ContextKind.None, word: "" };

  // First: is the cursor on a recorded reference occurrence? That's the
  // strongest signal (definition/hover of a real symbol). A cursor resting on
  // the identifier's trailing edge (exclusive-end boundary) should still resolve
  // it, so fall back one character — matching how editors treat end-of-word.
  const occ = a.refs.occurrenceAt(uri, pos)
    ?? (pos.character > 0 ? a.refs.occurrenceAt(uri, { line: pos.line, character: pos.character - 1 }) : null);
  if (occ !== null && occ.symbol !== "") {
    return { kind: ContextKind.Identifier, word: occ.symbol, symbol: occ.symbol };
  }

  const tp = positionToTodl(pos);
  const tokens = file.tokens;
  const idx = tokenIndexAt(tokens, tp.line, tp.column);
  const prev = precedingSignificant(tokens, idx);

  // Empty slot after a syntactic cue.
  if (prev !== null) {
    if (prev.kind === TokenKind.Colon) return { kind: ContextKind.TypeSlot, word: wordAt(tokens, idx) };
    if (prev.kind === TokenKind.SymbolOp && prev.value === "->") return { kind: ContextKind.RelationshipTarget, word: wordAt(tokens, idx) };
    if (prev.kind === TokenKind.Amp) return { kind: ContextKind.RefValue, word: wordAt(tokens, idx) };
    if (prev.kind === TokenKind.Identifier && prev.value === "import")
      return { kind: ContextKind.ImportPath, word: wordAt(tokens, idx) };
  }
  return { kind: ContextKind.None, word: wordAt(tokens, idx) };
}

// The index of the token whose span covers (line, column), else the index of the
// next token after the cursor (so an empty slot points at what follows).
function tokenIndexAt(tokens: Token[], line: number, column: number): number {
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === undefined) continue;
    const startsAfter = t.line > line || (t.line === line && t.column > column);
    if (startsAfter) return i;
    const endsAfter = t.endLine > line || (t.endLine === line && t.endColumn > column);
    if ((t.line < line || (t.line === line && t.column <= column)) && endsAfter) return i;
  }
  return tokens.length;
}

// The nearest significant token before `idx` (skipping EOF); null if none.
function precedingSignificant(tokens: Token[], idx: number): Token | null {
  for (let i = idx - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t !== undefined && t.kind !== TokenKind.EOF) return t;
  }
  return null;
}

function wordAt(tokens: Token[], idx: number): string {
  const t = tokens[idx];
  return t !== undefined && t.kind === TokenKind.Identifier ? t.value : "";
}
