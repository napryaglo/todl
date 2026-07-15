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
  /** Monotonic counter for synthesizing ids of id-less edge records. */
  private edgeSeq = 0;

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
    if (this.checkKeyword("application-connectors")) return this.parseApplicationConnectors();
    if (this.check(TokenKind.Identifier)) {
      if (this.peekKind(1) === TokenKind.Amp) return this.parseEdgeRecord(this.expectIdentifier());
      return this.parseInstance();
    }
    throw this.error(`expected a declaration (primitive / enum / concept / instance)`);
  }

  private parseInstance(): InstanceDecl {
    return this.parseInstanceFrom(this.expectIdentifier());
  }

  /**
   * Parse an instance record whose leading concept identifier has already been
   * consumed. Body members are either `name = value;` assignments or nested
   * `<concept> <id> { … }` records (containment). An optional `: <meta-model>`
   * binding may follow the id on a container record.
   */
  private parseInstanceFrom(concept: string): InstanceDecl {
    const id = this.expectRecordId();
    const binds = this.match(TokenKind.Colon) ? this.expectIdentifier() : null;
    const assignments: AssignmentNode[] = [];
    const children: InstanceDecl[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      if (this.checkKeyword("application-connectors")) {
        children.push(this.parseApplicationConnectors());
        continue;
      }
      const first = this.expectIdentifier();
      if (this.match(TokenKind.Equals)) {
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        assignments.push({ name: first, value });
      } else if (this.check(TokenKind.Amp)) {
        children.push(this.parseEdgeRecord(first));
      } else {
        children.push(this.parseInstanceFrom(first));
      }
    }
    this.expect(TokenKind.RBrace);
    return { kind: DeclKind.Instance, concept, id, binds, assignments, children };
  }

  /**
   * Parse an edge-shorthand record whose leading concept identifier is already
   * consumed: `<concept> &from (-> | -->) &to [ { … } | ; ]`. Materialized as an
   * instance carrying `from` / `to` reference assignments plus an `operator`
   * attr, so it flows through the normal instance machinery.
   */
  private parseEdgeRecord(concept: string): InstanceDecl {
    const from = this.parseRef();
    const operator = this.consumeEdgeOperator();
    const to = this.parseRef();
    const assignments: AssignmentNode[] = [
      { name: "from", value: { kind: ValueKind.Ref, ref: from } },
      { name: "to", value: { kind: ValueKind.Ref, ref: to } },
      { name: "operator", value: { kind: ValueKind.String, text: operator } },
    ];
    if (this.match(TokenKind.LBrace)) {
      while (!this.check(TokenKind.RBrace)) {
        const name = this.expectIdentifier();
        this.expect(TokenKind.Equals);
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        assignments.push({ name, value });
      }
      this.expect(TokenKind.RBrace);
    } else {
      this.match(TokenKind.Semicolon); // optional terminator (bare in an application-connectors block)
    }
    const id = `${concept}#${(this.edgeSeq += 1)}`;
    return { kind: DeclKind.Instance, concept, id, binds: null, assignments, children: [] };
  }

  /** Parse an `application-connectors { &a --> &b … }` block into a container of connectors. */
  private parseApplicationConnectors(): InstanceDecl {
    this.expectKeyword("application-connectors");
    this.expect(TokenKind.LBrace);
    const children: InstanceDecl[] = [];
    while (!this.check(TokenKind.RBrace)) {
      children.push(this.parseEdgeRecord("connector"));
    }
    this.expect(TokenKind.RBrace);
    const id = `application-connectors#${(this.edgeSeq += 1)}`;
    return { kind: DeclKind.Instance, concept: "application-connectors", id, binds: null, assignments: [], children };
  }

  private parseRef(): string {
    this.expect(TokenKind.Amp);
    return this.parseDottedPath();
  }

  private consumeEdgeOperator(): string {
    if (this.match(TokenKind.Arrow)) return "->";
    if (this.match(TokenKind.DoubleArrow)) return "-->";
    throw this.error(`expected "->" or "-->"`);
  }

  private parseValue(): ValueNode {
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString)) {
      return { kind: ValueKind.String, text: this.advance().value };
    }
    if (this.check(TokenKind.Number)) {
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
      } else if (this.checkKeyword("authoring")) {
        // Doc-only authoring-form blocks (`authoring list-form { … }`) carry no
        // schema; skip them.
        this.advance();
        this.expectIdentifier();
        this.skipBracedBlock();
      } else {
        const memberName = this.expectIdentifier();
        if (this.match(TokenKind.Colon)) {
          const type = this.parseFieldType();
          const cardinality = this.parseCardinality();
          this.expect(TokenKind.Semicolon);
          fields.push({ name: memberName, type, cardinality });
        } else if (this.match(TokenKind.Equals)) {
          if (this.check(TokenKind.String) || this.check(TokenKind.RawString)) {
            const value = this.parseStringValue();
            if (memberName === "description") description = value;
          } else {
            // Doc-only non-string members (`references = [ … ]`); skip.
            this.skipToSemicolon();
          }
          this.expect(TokenKind.Semicolon);
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

  /**
   * A field type: a bare identifier (`string`, `task-type`) or an inline
   * `object { name : <type> [card]; … }` composite, rendered to the flat
   * inline string the emitter stores (`object { id: identifier, ports: p[] }`).
   * Nests recursively. `list<T>` is not handled here — the rewriter lowers it
   * to `T[]` before the parser sees it.
   */
  private parseFieldType(): string {
    if (!this.checkKeyword("object")) return this.expectIdentifier();
    this.advance(); // object
    this.expect(TokenKind.LBrace);
    const parts: string[] = [];
    while (!this.check(TokenKind.RBrace)) {
      const name = this.expectIdentifier();
      this.expect(TokenKind.Colon);
      const type = this.parseFieldType();
      const suffix = cardinalitySuffix(this.parseCardinality());
      this.expect(TokenKind.Semicolon);
      parts.push(`${name}: ${type}${suffix}`);
    }
    this.expect(TokenKind.RBrace);
    return `object { ${parts.join(", ")} }`;
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

  /** Skip a balanced `{ … }` block (raw strings are single tokens, so brace-safe). */
  private skipBracedBlock(): void {
    this.expect(TokenKind.LBrace);
    let depth = 1;
    while (depth > 0 && !this.check(TokenKind.EOF)) {
      if (this.check(TokenKind.LBrace)) depth += 1;
      else if (this.check(TokenKind.RBrace)) depth -= 1;
      this.advance();
    }
  }

  /** Advance to (but not past) the next `;`. */
  private skipToSemicolon(): void {
    while (!this.check(TokenKind.Semicolon) && !this.check(TokenKind.EOF)) this.advance();
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

  private peekKind(offset: number): TokenKind {
    return (this.tokens[this.pos + offset] ?? EOF_TOKEN).kind;
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

  /** A record id — a bare identifier or a quoted string (e.g. `sequence "…"`). */
  private expectRecordId(): string {
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString)) {
      return this.advance().value;
    }
    return this.expectIdentifier();
  }

  private error(message: string): Error {
    const token = this.current();
    const got = token.value.length > 0 ? token.value : token.kind;
    return new Error(`${message} at ${token.line}:${token.column} (got "${got}")`);
  }
}

const EOF_TOKEN: Token = { kind: TokenKind.EOF, value: "", line: 0, column: 0 };

/** Cardinality → surface suffix, for rendering inline object-field types. */
function cardinalitySuffix(cardinality: Cardinality): string {
  switch (cardinality) {
    case Cardinality.Optional:
      return "?";
    case Cardinality.Many:
      return "[]";
    case Cardinality.NonEmpty:
      return "[+]";
    case Cardinality.One:
      return "";
  }
}
