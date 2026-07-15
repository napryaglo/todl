/**
 * Recursive-descent parser for TODL declarations (design spec §3): a single
 * `namespace` block of imports and `primitive` / `enum` / `concept`
 * declarations. Fields and relationships carry `?` / `[]` / `[+]` cardinality;
 * invariant predicates are captured as raw token slices for the predicate
 * parser. Strict: every statement ends in `;`; mismatches fail loud with
 * line:column.
 */

import { tokenize, TokenKind, type Token } from "./lexer.js";
import { Cardinality } from "../model/graph.js";
import {
  DeclKind,
  ValueKind,
  type NamespaceNode,
  type Declaration,
  type ConceptDecl,
  type EnumDecl,
  type PrimitiveDecl,
  type FieldDecl,
  type RelationshipDecl,
  type InvariantDecl,
  type EnumCase,
  type InstanceDecl,
  type AssignmentNode,
  type ValueNode,
} from "./ast.js";

export function parse(source: string): NamespaceNode {
  return new Parser(tokenize(source)).parseNamespace();
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseNamespace(): NamespaceNode {
    this.expectKeyword("namespace");
    const path = this.parseDottedPath();
    this.expect(TokenKind.LBrace);

    const imports: string[] = [];
    while (this.checkKeyword("import")) {
      this.advance();
      imports.push(this.parseDottedPath());
      this.expect(TokenKind.Semicolon);
    }

    const declarations: Declaration[] = [];
    while (!this.check(TokenKind.RBrace)) {
      declarations.push(this.parseDeclaration());
    }
    this.expect(TokenKind.RBrace);
    return { path, imports, declarations };
  }

  private parseDeclaration(): Declaration {
    while (this.checkKeyword("internal") || this.checkKeyword("sealed")) this.advance();

    if (this.checkKeyword("primitive")) return this.parsePrimitive();
    if (this.checkKeyword("enum")) return this.parseEnum();
    if (this.checkKeyword("concept")) return this.parseConcept();
    if (this.check(TokenKind.Identifier)) return this.parseInstance();
    throw this.error(`expected a declaration (primitive / enum / concept / instance)`);
  }

  private parseInstance(): InstanceDecl {
    const concept = this.expectIdentifier();
    const id = this.expectIdentifier();
    const assignments: AssignmentNode[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const name = this.expectIdentifier();
      this.expect(TokenKind.Equals);
      const value = this.parseValue();
      this.expect(TokenKind.Semicolon);
      assignments.push({ name, value });
    }
    this.expect(TokenKind.RBrace);
    return { kind: DeclKind.Instance, concept, id, assignments };
  }

  private parseValue(): ValueNode {
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString)) {
      return { kind: ValueKind.String, text: this.advance().value };
    }
    if (this.match(TokenKind.Amp)) {
      return { kind: ValueKind.Ref, ref: this.parseDottedPath() };
    }
    if (this.match(TokenKind.LBracket)) {
      const items: ValueNode[] = [];
      if (!this.check(TokenKind.RBracket)) {
        items.push(this.parseValue());
        while (this.match(TokenKind.Comma)) items.push(this.parseValue());
      }
      this.expect(TokenKind.RBracket);
      return { kind: ValueKind.List, items };
    }
    if (this.check(TokenKind.Identifier)) {
      const first = this.advance().value;
      if (this.check(TokenKind.Pipe)) {
        const parts = [first];
        while (this.match(TokenKind.Pipe)) parts.push(this.expectIdentifier());
        return { kind: ValueKind.Composite, parts };
      }
      return { kind: ValueKind.Name, name: first };
    }
    throw this.error(`expected a value`);
  }

  private parsePrimitive(): PrimitiveDecl {
    this.expectKeyword("primitive");
    const name = this.expectIdentifier();
    const base = this.match(TokenKind.Colon) ? this.expectIdentifier() : null;

    let description = "";
    let regex: string | null = null;
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const key = this.expectIdentifier();
      this.expect(TokenKind.Equals);
      const value = this.parseStringValue();
      this.expect(TokenKind.Semicolon);
      if (key === "description") description = value;
      else if (key === "regex") regex = value;
    }
    this.expect(TokenKind.RBrace);
    return { kind: DeclKind.Primitive, name, base, description, regex };
  }

  private parseEnum(): EnumDecl {
    this.expectKeyword("enum");
    const name = this.expectIdentifier();

    let description = "";
    const cases: EnumCase[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      if (this.checkKeyword("values")) {
        this.parseEnumValues(cases);
      } else {
        const key = this.expectIdentifier();
        this.expect(TokenKind.Equals);
        const value = this.parseStringValue();
        this.expect(TokenKind.Semicolon);
        if (key === "description") description = value;
      }
    }
    this.expect(TokenKind.RBrace);
    return { kind: DeclKind.Enum, name, description, cases };
  }

  private parseEnumValues(cases: EnumCase[]): void {
    this.expectKeyword("values");
    this.expect(TokenKind.LBrace);
    while (this.check(TokenKind.Pipe)) {
      this.advance();
      const id = this.expectIdentifier();
      let label = "";
      let description = "";
      this.expect(TokenKind.LBrace);
      while (!this.check(TokenKind.RBrace)) {
        const key = this.expectIdentifier();
        this.expect(TokenKind.Equals);
        const value = this.parseStringValue();
        this.expect(TokenKind.Semicolon);
        if (key === "label") label = value;
        else if (key === "description") description = value;
      }
      this.expect(TokenKind.RBrace);
      cases.push({ id, label, description });
    }
    this.expect(TokenKind.RBrace);
  }

  private parseConcept(): ConceptDecl {
    this.expectKeyword("concept");
    const name = this.expectIdentifier();
    const extendsName = this.match(TokenKind.Colon) ? this.expectIdentifier() : null;

    let description = "";
    const fields: FieldDecl[] = [];
    const relationships: RelationshipDecl[] = [];
    const invariants: InvariantDecl[] = [];

    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      if (this.checkKeyword("relationship")) {
        relationships.push(this.parseRelationship());
      } else if (this.checkKeyword("invariant")) {
        invariants.push(this.parseInvariant());
      } else {
        const memberName = this.expectIdentifier();
        if (this.match(TokenKind.Colon)) {
          const type = this.expectIdentifier();
          const cardinality = this.parseCardinality();
          this.expect(TokenKind.Semicolon);
          fields.push({ name: memberName, type, cardinality });
        } else if (this.match(TokenKind.Equals)) {
          const value = this.parseStringValue();
          this.expect(TokenKind.Semicolon);
          if (memberName === "description") description = value;
        } else {
          throw this.error(`expected ":" (field) or "=" (assignment) after "${memberName}"`);
        }
      }
    }
    this.expect(TokenKind.RBrace);
    return { kind: DeclKind.Concept, name, extends: extendsName, description, fields, relationships, invariants };
  }

  private parseRelationship(): RelationshipDecl {
    this.expectKeyword("relationship");
    const name = this.expectIdentifier();
    this.expect(TokenKind.Arrow);
    const target = this.expectIdentifier();
    const cardinality = this.parseCardinality();
    this.expect(TokenKind.Semicolon);
    return { name, target, cardinality };
  }

  private parseInvariant(): InvariantDecl {
    this.expectKeyword("invariant");
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString)) {
      const description = this.parseStringValue();
      this.expect(TokenKind.Semicolon);
      return { description, predicate: null };
    }

    let description = "";
    let predicate: Token[] | null = null;
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const key = this.expectIdentifier();
      this.expect(TokenKind.Equals);
      if (key === "predicate") {
        predicate = this.collectUntilSemicolon();
        this.expect(TokenKind.Semicolon);
      } else {
        const value = this.parseStringValue();
        this.expect(TokenKind.Semicolon);
        if (key === "description") description = value;
      }
    }
    this.expect(TokenKind.RBrace);
    return { description, predicate };
  }

  private parseCardinality(): Cardinality {
    if (this.match(TokenKind.Question)) return Cardinality.Optional;
    if (this.check(TokenKind.LBracket)) {
      this.advance();
      if (this.match(TokenKind.Plus)) {
        this.expect(TokenKind.RBracket);
        return Cardinality.NonEmpty;
      }
      this.expect(TokenKind.RBracket);
      return Cardinality.Many;
    }
    return Cardinality.One;
  }

  private parseDottedPath(): string {
    const parts = [this.expectIdentifier()];
    while (this.match(TokenKind.Dot)) {
      parts.push(this.expectIdentifier());
    }
    return parts.join(".");
  }

  private parseStringValue(): string {
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString)) {
      return this.advance().value;
    }
    throw this.error(`expected a string value`);
  }

  private collectUntilSemicolon(): Token[] {
    const start = this.pos;
    while (!this.check(TokenKind.Semicolon) && !this.check(TokenKind.EOF)) this.advance();
    return this.tokens.slice(start, this.pos);
  }

  // ── Cursor helpers ────────────────────────────────────────────────────────

  private current(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1] ?? EOF_TOKEN;
  }

  private check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  private checkKeyword(word: string): boolean {
    const token = this.current();
    return token.kind === TokenKind.Identifier && token.value === word;
  }

  private match(kind: TokenKind): boolean {
    if (this.check(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  private advance(): Token {
    const token = this.current();
    if (this.pos < this.tokens.length - 1) this.pos += 1;
    return token;
  }

  private expect(kind: TokenKind): Token {
    if (!this.check(kind)) throw this.error(`expected "${kind}"`);
    return this.advance();
  }

  private expectKeyword(word: string): Token {
    if (!this.checkKeyword(word)) throw this.error(`expected "${word}"`);
    return this.advance();
  }

  private expectIdentifier(): string {
    return this.expect(TokenKind.Identifier).value;
  }

  private error(message: string): Error {
    const token = this.current();
    const got = token.value.length > 0 ? token.value : token.kind;
    return new Error(`${message} at ${token.line}:${token.column} (got "${got}")`);
  }
}

const EOF_TOKEN: Token = { kind: TokenKind.EOF, value: "", line: 0, column: 0 };
