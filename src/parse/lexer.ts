/**
 * Lexer for the TODL surface (design spec §3, legacy `adl/todl/spec.md` §2).
 * C-like identifiers (`[A-Za-z_][A-Za-z0-9_]*`), string and raw-string (`"""`) literals, the `&`
 * reference sigil, `?` / `[]` / `[+]` cardinality punctuation, and the
 * predicate operators (`==` `!=` `&&` `||` `implies` …). Line and block comments
 * and whitespace are trivia. Unknown characters (`$`, `@` — reserved for Mural)
 * fail loud with line:column.
 */

import { type Diagnostic, DiagnosticCode, Severity } from "../diagnostics/diagnostic.js";

export enum TokenKind {
  Identifier = "identifier",
  String = "string",
  RawString = "raw-string",
  Number = "number",
  LBrace = "{",
  RBrace = "}",
  LBracket = "[",
  RBracket = "]",
  LParen = "(",
  RParen = ")",
  LAngle = "<",
  RAngle = ">",
  Semicolon = ";",
  Comma = ",",
  Colon = ":",
  Equals = "=",
  Arrow = "->",
  DoubleArrow = "-->",
  Pipe = "|",
  Amp = "&",
  Question = "?",
  Plus = "+",
  Star = "*",
  Dot = ".",
  Bang = "!",
  EqEq = "==",
  NotEq = "!=",
  And = "&&",
  Or = "||",
  EOF = "eof",
}

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export function tokenize(source: string): Token[] {
  return new Lexer(source, "<anonymous>").scan();
}

export function lex(source: string, uri: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const lexer = new Lexer(source, uri);
  const tokens = lexer.scan();
  return { tokens, diagnostics: lexer.diagnostics };
}

const SINGLE_CHAR: ReadonlyMap<string, TokenKind> = new Map([
  ["{", TokenKind.LBrace],
  ["}", TokenKind.RBrace],
  ["[", TokenKind.LBracket],
  ["]", TokenKind.RBracket],
  ["(", TokenKind.LParen],
  [")", TokenKind.RParen],
  ["<", TokenKind.LAngle],
  [">", TokenKind.RAngle],
  [";", TokenKind.Semicolon],
  [",", TokenKind.Comma],
  [":", TokenKind.Colon],
  ["?", TokenKind.Question],
  ["+", TokenKind.Plus],
  ["*", TokenKind.Star],
  [".", TokenKind.Dot],
]);

class Lexer {
  private pos = 0;
  private line = 1;
  private column = 1;
  private readonly tokens: Token[] = [];
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly source: string, private readonly uri: string) {}

  private report(code: DiagnosticCode, message: string, line: number, column: number, endColumn: number): void {
    this.diagnostics.push({
      code,
      severity: Severity.Error,
      message,
      span: { uri: this.uri, start: { line, column }, end: { line, column: endColumn } },
      node: null,
      path: null,
    });
  }

  scan(): Token[] {
    for (;;) {
      this.skipTrivia();
      if (this.pos >= this.source.length) break;

      const line = this.line;
      const column = this.column;
      const char = this.peek();

      if (isIdentifierStart(char)) {
        const value = this.readIdentifier();
        this.tokens.push({ kind: TokenKind.Identifier, value, line, column, endLine: this.line, endColumn: this.column });
        continue;
      }
      if (isDigit(char)) {
        const value = this.readNumber();
        this.tokens.push({ kind: TokenKind.Number, value, line, column, endLine: this.line, endColumn: this.column });
        continue;
      }
      if (char === '"') {
        this.readStringLike(line, column);
        continue;
      }
      this.readOperator(line, column);
    }

    this.tokens.push({ kind: TokenKind.EOF, value: "", line: this.line, column: this.column, endLine: this.line, endColumn: this.column });
    return this.tokens;
  }

  private readOperator(line: number, column: number): void {
    const char = this.peek();
    const next = this.peek(1);

    const three = char + next + this.peek(2);
    if (three === "-->") return this.push(TokenKind.DoubleArrow, "-->", line, column, 3);

    const two = char + next;
    if (two === "->") return this.push(TokenKind.Arrow, "->", line, column, 2);
    if (two === "==") return this.push(TokenKind.EqEq, "==", line, column, 2);
    if (two === "!=") return this.push(TokenKind.NotEq, "!=", line, column, 2);
    if (two === "&&") return this.push(TokenKind.And, "&&", line, column, 2);
    if (two === "||") return this.push(TokenKind.Or, "||", line, column, 2);

    const single = SINGLE_CHAR.get(char);
    if (single !== undefined) return this.push(single, char, line, column, 1);
    if (char === "=") return this.push(TokenKind.Equals, "=", line, column, 1);
    if (char === "&") return this.push(TokenKind.Amp, "&", line, column, 1);
    if (char === "|") return this.push(TokenKind.Pipe, "|", line, column, 1);
    if (char === "!") return this.push(TokenKind.Bang, "!", line, column, 1);

    this.report(DiagnosticCode.UnexpectedCharacter, `unexpected character "${char}"`, line, column, column + 1);
    this.advance(); // skip the offending character and continue
  }

  private readStringLike(line: number, column: number): void {
    if (this.peek(1) === '"' && this.peek(2) === '"') {
      this.push(TokenKind.RawString, this.readRawString(), line, column, 0);
    } else {
      this.push(TokenKind.String, this.readString(line, column), line, column, 0);
    }
  }

  private readIdentifier(): string {
    const start = this.pos;
    this.advance();
    for (;;) {
      const char = this.peek();
      if (isIdentifierPart(char)) {
        this.advance();
      } else {
        break;
      }
    }
    return this.source.slice(start, this.pos);
  }

  private readNumber(): string {
    const start = this.pos;
    while (isDigit(this.peek())) this.advance();
    if (this.peek() === "." && isDigit(this.peek(1))) {
      this.advance();
      while (isDigit(this.peek())) this.advance();
    }
    return this.source.slice(start, this.pos);
  }

  private readString(line: number, column: number): string {
    this.advance(); // opening quote
    let value = "";
    while (this.peek() !== '"') {
      if (this.pos >= this.source.length || this.peek() === "\n") {
        this.report(DiagnosticCode.UnterminatedString, "unterminated string", line, column, this.column);
        return value; // recover: emit the partial string, do not consume the newline/EOF
      }
      if (this.peek() === "\\") {
        this.advance();
        value += unescape(this.peek());
        this.advance();
      } else {
        value += this.peek();
        this.advance();
      }
    }
    this.advance(); // closing quote
    return value;
  }

  private readRawString(): string {
    this.advance();
    this.advance();
    this.advance(); // opening """
    const start = this.pos;
    while (!(this.peek() === '"' && this.peek(1) === '"' && this.peek(2) === '"')) {
      if (this.pos >= this.source.length) {
        this.report(DiagnosticCode.UnterminatedString, "unterminated raw string", this.line, this.column, this.column);
        return stripCommonIndent(this.source.slice(start, this.pos));
      }
      this.advance();
    }
    const raw = this.source.slice(start, this.pos);
    this.advance();
    this.advance();
    this.advance(); // closing """
    return stripCommonIndent(raw);
  }

  private skipTrivia(): void {
    for (;;) {
      const char = this.peek();
      if (char === " " || char === "\t" || char === "\r" || char === "\n") {
        this.advance();
      } else if (char === "/" && this.peek(1) === "/") {
        while (this.pos < this.source.length && this.peek() !== "\n") this.advance();
      } else if (char === "/" && this.peek(1) === "*") {
        this.advance();
        this.advance();
        while (this.pos < this.source.length && !(this.peek() === "*" && this.peek(1) === "/")) this.advance();
        this.advance();
        this.advance();
      } else {
        break;
      }
    }
  }

  private push(kind: TokenKind, value: string, line: number, column: number, consume: number): void {
    for (let i = 0; i < consume; i++) this.advance();
    this.tokens.push({ kind, value, line, column, endLine: this.line, endColumn: this.column });
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? "";
  }

  private advance(): void {
    if (this.source[this.pos] === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    this.pos += 1;
  }
}

/** Decode a backslash-escaped character in a double-quoted string. */
function unescape(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    default:
      return char; // `\"`, `\\`, and anything else pass through literally
  }
}

function isIdentifierStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || (char >= "0" && char <= "9");
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function stripCommonIndent(text: string): string {
  const lines = text.split("\n");
  while (lines.length > 0 && (lines[0] ?? "").trim() === "") lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();

  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    min = Math.min(min, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(min)) min = 0;

  return lines.map((line) => line.slice(min)).join("\n");
}
