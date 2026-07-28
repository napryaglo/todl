import type { Range, Position } from "vscode-languageserver-types";
import type { SourceSpan, Position as TodlPosition } from "../diagnostics/span.js";

// TODL positions are 1-based line/column; LSP positions are 0-based
// line/character. Both use an exclusive end. This module is the ONLY place in
// the language service that does the ±1 conversion.

export function spanToRange(span: SourceSpan): Range {
  return {
    start: { line: span.start.line - 1, character: span.start.column - 1 },
    end: { line: span.end.line - 1, character: span.end.column - 1 },
  };
}

export function positionToTodl(pos: Position): TodlPosition {
  return { line: pos.line + 1, column: pos.character + 1 };
}

export function rangeToSpan(uri: string, range: Range): SourceSpan {
  return {
    uri,
    start: { line: range.start.line + 1, column: range.start.character + 1 },
    end: { line: range.end.line + 1, column: range.end.character + 1 },
  };
}
