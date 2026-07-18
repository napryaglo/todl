import type { Token } from "../parse/lexer.js";

/** 1-based line, 1-based column. */
export interface Position {
  line: number;
  column: number;
}

/** A source range; `end` is exclusive (one past the last character). */
export interface SourceSpan {
  uri: string;
  start: Position;
  end: Position;
}

/** A named source unit — file identity survives multi-file loads. */
export interface SourceFile {
  uri: string;
  text: string;
}

/** Span a single token using the end position the lexer recorded. */
export function tokenSpan(token: Token, uri: string): SourceSpan {
  return {
    uri,
    start: { line: token.line, column: token.column },
    end: { line: token.endLine, column: token.endColumn },
  };
}
