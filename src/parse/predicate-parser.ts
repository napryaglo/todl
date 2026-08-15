/**
 * Parses a predicate token slice (captured by the declaration parser from a
 * `predicate = …` invariant) into the predicate {@link Expr} AST (design spec
 * §4.5). Precedence, lowest to highest: `||`, `&&`, `implies`, comparison
 * (`==` / `!=` / `in`), member/closure postfix, primary.
 *
 * `x.empty` desugars to `x == none` (both mean "the set is empty").
 */

import { TokenKind, type Token } from "./lexer.js";
import {
  THIS,
  NONE,
  name,
  member,
  eq,
  neq,
  isIn,
  and,
  or,
  implies,
  type Expr,
} from "../predicate/ast.js";

export function parsePredicate(tokens: Token[]): Expr {
  const parser = new PredicateParser(tokens);
  const expr = parser.parseExpression();
  parser.expectEnd();
  return expr;
}

class PredicateParser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseExpression(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.match(TokenKind.Or)) {
      left = or(left, this.parseAnd());
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseImplies();
    while (this.match(TokenKind.And)) {
      left = and(left, this.parseImplies());
    }
    return left;
  }

  private parseImplies(): Expr {
    const left = this.parseComparison();
    if (this.matchKeyword("implies")) {
      return implies(left, this.parseComparison());
    }
    return left;
  }

  private parseComparison(): Expr {
    const left = this.parsePostfix();
    if (this.matchSymbol("==")) return eq(left, this.parsePostfix());
    if (this.matchSymbol("!=")) return neq(left, this.parsePostfix());
    if (this.matchKeyword("in")) return isIn(left, this.parsePostfix());
    return left;
  }

  private parsePostfix(): Expr {
    let left = this.parsePrimary();
    while (this.match(TokenKind.Dot)) {
      const member_ = this.expectIdentifier();
      left = member_ === "empty" ? eq(left, NONE) : member(left, member_);
    }
    return left;
  }

  private parsePrimary(): Expr {
    if (this.matchKeyword("this")) return THIS;
    if (this.matchKeyword("none")) return NONE;
    if (this.match(TokenKind.LParen)) {
      const inner = this.parseExpression();
      this.expect(TokenKind.RParen);
      return inner;
    }
    if (this.match(TokenKind.Amp)) {
      return name(this.expectIdentifier());
    }
    if (this.check(TokenKind.Identifier)) {
      return name(this.advance().value);
    }
    throw this.error("expected an expression");
  }

  expectEnd(): void {
    if (this.pos < this.tokens.length) {
      throw this.error("unexpected trailing tokens in predicate");
    }
  }

  private current(): Token | undefined {
    return this.tokens[this.pos];
  }

  private check(kind: TokenKind): boolean {
    return this.current()?.kind === kind;
  }

  private checkKeyword(word: string): boolean {
    const token = this.current();
    return token?.kind === TokenKind.Identifier && token.value === word;
  }

  private match(kind: TokenKind): boolean {
    if (this.check(kind)) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  /** Match a SymbolOp token with exactly `value` (e.g. `==`, `!=`). */
  private matchSymbol(value: string): boolean {
    const token = this.current();
    if (token?.kind === TokenKind.SymbolOp && token.value === value) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private matchKeyword(word: string): boolean {
    if (this.checkKeyword(word)) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private advance(): Token {
    const token = this.current();
    if (token === undefined) throw this.error("unexpected end of predicate");
    this.pos += 1;
    return token;
  }

  private expect(kind: TokenKind): Token {
    if (!this.check(kind)) throw this.error(`expected "${kind}"`);
    return this.advance();
  }

  private expectIdentifier(): string {
    return this.expect(TokenKind.Identifier).value;
  }

  private error(message: string): Error {
    const token = this.current();
    if (token === undefined) return new Error(`${message} at end of predicate`);
    const got = token.value.length > 0 ? token.value : token.kind;
    return new Error(`${message} at ${token.line}:${token.column} (got "${got}")`);
  }
}
