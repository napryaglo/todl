/**
 * Recursive-descent parser for TODL declarations (design spec §3): a single
 * `namespace` block of imports and `primitive` / `enum` / `concept`
 * declarations. Fields and relationships carry `?` / `[]` / `[+]` cardinality;
 * invariant predicates are captured as raw token slices for the predicate
 * parser. Strict: every statement ends in `;`; mismatches fail loud with
 * line:column.
 */

import { lex, TokenKind, type Token } from "./lexer.js";
import { Cardinality } from "../model/graph.js";
import { type SourceSpan, tokenSpan } from "../diagnostics/span.js";
import { type Diagnostic, DiagnosticCode, Severity } from "../diagnostics/diagnostic.js";
import {
  DeclKind,
  ValueKind,
  type NamespaceNode,
  type Declaration,
  type ConceptDecl,
  type PrimitiveDecl,
  type FieldDecl,
  type RelationshipDecl,
  type InvariantDecl,
  type Term,
  type TaxonomyDecl,
  type InstanceDecl,
  type ModelDecl,
  type AnnotationDecl,
  type AnnotationApplication,
  type PackageDecl,
  type AssignmentNode,
  type ValueNode,
} from "./ast.js";

export interface ParseResult {
  namespace: NamespaceNode;
  diagnostics: Diagnostic[];
}

export function parse(source: string, uri = "<anonymous>"): ParseResult {
  const { tokens, diagnostics } = lex(source, uri);
  return new Parser(tokens, uri, diagnostics).parse();
}

/** Thrown internally on a syntax error; carries the offending token for spanning. */
class ParseError extends Error {
  constructor(message: string, readonly token: Token) {
    super(message);
  }
}

class Parser {
  private pos = 0;
  /** Monotonic counter for synthesizing ids of id-less edge records. */
  private edgeSeq = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly uri: string,
    private readonly diagnostics: Diagnostic[],
  ) {}

  parse(): ParseResult {
    try {
      const namespace = this.parseNamespace();
      return { namespace, diagnostics: this.diagnostics };
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      this.diagnostics.push(this.toDiagnostic(err));
      const span = tokenSpan(err.token, this.uri);
      return { namespace: { path: "", imports: [], declarations: [], span }, diagnostics: this.diagnostics };
    }
  }

  private toDiagnostic(err: ParseError): Diagnostic {
    return {
      code: DiagnosticCode.UnexpectedToken,
      severity: Severity.Error,
      message: err.message,
      span: tokenSpan(err.token, this.uri),
      node: null,
      path: null,
    };
  }

  /** Skip tokens after a syntax error to the next declaration boundary. Brace-aware
   * so an inner `}` isn't mistaken for the namespace's closing brace. */
  private synchronize(): void {
    let depth = 0;
    while (!this.check(TokenKind.EOF)) {
      const kind = this.current().kind;
      if (kind === TokenKind.LBrace) {
        depth += 1;
        this.advance();
        continue;
      }
      if (kind === TokenKind.RBrace) {
        if (depth === 0) return; // closes the enclosing namespace — stop here
        depth -= 1;
        this.advance();
        continue;
      }
      if (
        depth === 0 &&
        (this.checkKeyword("primitive") ||
          this.checkKeyword("taxonomy") ||
          this.checkKeyword("concept") ||
          this.checkKeyword("internal") ||
          this.checkKeyword("sealed") ||
          this.checkKeyword("application-connectors") ||
          kind === TokenKind.Identifier)
      ) {
        return;
      }
      this.advance();
    }
  }

  /** The next unconsumed token — the start of whatever we're about to parse. */
  private startToken(): Token {
    return this.current();
  }

  /** Span from `start` through the last consumed token (the one before the cursor). */
  private spanFrom(start: Token): SourceSpan {
    const last = this.tokens[this.pos > 0 ? this.pos - 1 : 0] ?? start;
    return {
      uri: this.uri,
      start: { line: start.line, column: start.column },
      end: { line: last.endLine, column: last.endColumn },
    };
  }

  parseNamespace(): NamespaceNode {
    const start = this.startToken();
    this.expectKeyword("namespace");
    const path = this.parseDottedPath();
    this.expect(TokenKind.LBrace);

    const imports: string[] = [];
    const importSpans: SourceSpan[] = [];
    while (this.checkKeyword("import")) {
      this.advance();
      const startTok = this.current();
      imports.push(this.parseDottedPath());
      importSpans.push(this.spanFrom(startTok));
      this.expect(TokenKind.Semicolon);
    }

    const declarations: Declaration[] = [];
    while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
      const before = this.pos;
      try {
        declarations.push(this.parseDeclaration());
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        this.diagnostics.push(this.toDiagnostic(err));
        this.synchronize();
        if (this.pos === before) this.advance(); // guarantee forward progress
      }
    }
    this.expect(TokenKind.RBrace);
    return { path, imports, declarations, span: this.spanFrom(start), importSpans };
  }

  private parseDeclaration(): Declaration {
    while (this.checkKeyword("internal") || this.checkKeyword("sealed")) this.advance();

    const start = this.startToken();
    if (this.checkKeyword("primitive")) return this.parsePrimitive(start);
    if (this.checkKeyword("taxonomy")) return this.parseTaxonomy(start);
    if (this.checkKeyword("concept")) return this.parseConcept(start);
    if (this.checkKeyword("model")) return this.parseModel(start);
    if (this.checkKeyword("annotation")) return this.parseAnnotation(start);
    if (this.checkKeyword("package")) return this.parsePackage(start);
    if (this.checkKeyword("class")) {
      this.advance(); // class modifier
      return this.parseInstanceFrom(this.expectIdentifier(), start, true);
    }
    if (this.checkKeyword("application-connectors")) return this.parseApplicationConnectors(start);
    if (this.check(TokenKind.Identifier)) {
      const conceptTok = this.expect(TokenKind.Identifier);
      if (this.check(TokenKind.Amp)) return this.parseEdgeRecord(conceptTok.value, start);
      return this.parseInstanceFrom(conceptTok.value, start, false, tokenSpan(conceptTok, this.uri));
    }
    throw this.error(`expected a declaration (primitive / enum / concept / instance)`);
  }

  /**
   * Parse an instance record whose leading concept identifier has already been
   * consumed. Body members are either `name = value;` assignments or nested
   * `<concept> <id> { … }` records (containment). An optional `: <meta-model>`
   * binding may follow the id on a container record.
   */
  private parseInstanceFrom(concept: string, start: Token, isClass = false, conceptSpan?: SourceSpan): InstanceDecl {
    const idTok = this.expectRecordIdTok();
    const id = idTok.value;
    let instanceOf: string | null = null;
    let instanceOfSpan: SourceSpan | undefined;
    if (this.checkKeyword("instanceof")) {
      this.advance();
      const t = this.expect(TokenKind.Identifier);
      instanceOf = t.value;
      instanceOfSpan = tokenSpan(t, this.uri);
    }
    const binds = this.match(TokenKind.Colon) ? this.expectIdentifier() : null;
    const assignments: AssignmentNode[] = [];
    const children: InstanceDecl[] = [];
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const memberStart = this.startToken();
      if (this.checkKeyword("annotate")) {
        annotations.push(this.parseAnnotationApplication(memberStart));
        continue;
      }
      if (this.checkKeyword("application-connectors")) {
        children.push(this.parseApplicationConnectors(memberStart));
        continue;
      }
      const first = this.expectIdentifier();
      if (this.match(TokenKind.Equals)) {
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        assignments.push({ name: first, value, span: this.spanFrom(memberStart) });
      } else if (this.check(TokenKind.Amp)) {
        children.push(this.parseEdgeRecord(first, memberStart));
      } else {
        children.push(this.parseInstanceFrom(first, memberStart));
      }
    }
    this.expect(TokenKind.RBrace);
    const decl: InstanceDecl = { kind: DeclKind.Instance, concept, id, binds, isClass, instanceOf, assignments, children, annotations, span: this.spanFrom(start) };
    if (conceptSpan !== undefined) decl.conceptSpan = conceptSpan;
    if (instanceOfSpan !== undefined) decl.instanceOfSpan = instanceOfSpan;
    decl.idSpan = tokenSpan(idTok, this.uri);
    return decl;
  }

  /**
   * Parse a model: `model <id> : <meta-model> [uses <lib>, …] { <objects> }`.
   * The body reuses instance-record parsing for each contained object.
   */
  private parseModel(start: Token): ModelDecl {
    this.expectKeyword("model");
    const idTok = this.expect(TokenKind.Identifier);
    this.expect(TokenKind.Colon);
    const metaTok = this.expect(TokenKind.Identifier);
    const libraries: string[] = [];
    const librarySpans: SourceSpan[] = [];
    if (this.checkKeyword("uses")) {
      this.advance();
      do {
        const libTok = this.expect(TokenKind.Identifier);
        libraries.push(libTok.value);
        librarySpans.push(tokenSpan(libTok, this.uri));
      } while (this.match(TokenKind.Comma));
    }
    const instances: InstanceDecl[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const memberStart = this.startToken();
      if (this.checkKeyword("application-connectors")) {
        instances.push(this.parseApplicationConnectors(memberStart));
        continue;
      }
      const first = this.expect(TokenKind.Identifier);
      if (this.check(TokenKind.Amp)) {
        instances.push(this.parseEdgeRecord(first.value, memberStart));
        continue;
      }
      instances.push(this.parseInstanceFrom(first.value, memberStart, false, tokenSpan(first, this.uri)));
    }
    this.expect(TokenKind.RBrace);
    const decl: ModelDecl = {
      kind: DeclKind.Model,
      id: idTok.value,
      metaModel: metaTok.value,
      libraries,
      instances,
      span: this.spanFrom(start),
    };
    decl.idSpan = tokenSpan(idTok, this.uri);
    decl.metaModelSpan = tokenSpan(metaTok, this.uri);
    if (librarySpans.length > 0) decl.librarySpans = librarySpans;
    return decl;
  }

  /** `annotation <Name> { <param> : <type><card>; … }` — typed param fields. */
  private parseAnnotation(start: Token): AnnotationDecl {
    this.expectKeyword("annotation");
    const nameTok = this.expect(TokenKind.Identifier);
    const params: FieldDecl[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const pNameTok = this.expect(TokenKind.Identifier);
      this.expect(TokenKind.Colon);
      const typeTok = this.expect(TokenKind.Identifier);
      const cardinality = this.parseCardinality();
      this.expect(TokenKind.Semicolon);
      params.push({
        name: pNameTok.value, type: typeTok.value, cardinality,
        nameSpan: tokenSpan(pNameTok, this.uri), typeSpan: tokenSpan(typeTok, this.uri),
      });
    }
    this.expect(TokenKind.RBrace);
    const decl: AnnotationDecl = { kind: DeclKind.Annotation, name: nameTok.value, params, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    return decl;
  }

  /** `annotate <Name> { <param> = <value>; … }` — an application (concept or package body). */
  private parseAnnotationApplication(start: Token): AnnotationApplication {
    this.expectKeyword("annotate");
    const nameTok = this.expect(TokenKind.Identifier);
    const assignments: AssignmentNode[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const aStart = this.startToken();
      const pName = this.expect(TokenKind.Identifier).value;
      this.expect(TokenKind.Equals);
      const value = this.parseValue();
      this.expect(TokenKind.Semicolon);
      assignments.push({ name: pName, value, span: this.spanFrom(aStart) });
    }
    this.expect(TokenKind.RBrace);
    const app: AnnotationApplication = { name: nameTok.value, assignments, span: this.spanFrom(start) };
    app.nameSpan = tokenSpan(nameTok, this.uri);
    return app;
  }

  /** `package { annotate … }` — a block of package-level applications. */
  private parsePackage(start: Token): PackageDecl {
    this.expectKeyword("package");
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      if (!this.checkKeyword("annotate")) throw this.error(`expected "annotate" in a package block`);
      annotations.push(this.parseAnnotationApplication(this.startToken()));
    }
    this.expect(TokenKind.RBrace);
    return { kind: DeclKind.Package, annotations, span: this.spanFrom(start) };
  }

  /**
   * Parse an edge-shorthand record whose leading concept identifier is already
   * consumed: `<concept> &from (-> | -->) &to [ { … } | ; ]`. Materialized as an
   * instance carrying `from` / `to` reference assignments plus an `operator`
   * attr, so it flows through the normal instance machinery.
   */
  private parseEdgeRecord(concept: string, start: Token): InstanceDecl {
    const from = this.parseRef();
    const operator = this.consumeEdgeOperator();
    const to = this.parseRef();
    // `step` names its endpoints src/dst; connectors use from/to.
    const [fromField, toField] = concept === "step" ? ["src", "dst"] : ["from", "to"];
    const assignments: AssignmentNode[] = [
      { name: fromField, value: { kind: ValueKind.Ref, ref: from } },
      { name: toField, value: { kind: ValueKind.Ref, ref: to } },
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
    return { kind: DeclKind.Instance, concept, id, binds: null, isClass: false, instanceOf: null, assignments, children: [], annotations: [], span: this.spanFrom(start) };
  }

  /** Parse an `application-connectors { &a --> &b … }` block into a container of connectors. */
  private parseApplicationConnectors(start: Token): InstanceDecl {
    this.expectKeyword("application-connectors");
    this.expect(TokenKind.LBrace);
    const children: InstanceDecl[] = [];
    while (!this.check(TokenKind.RBrace)) {
      const edgeStart = this.startToken();
      children.push(this.parseEdgeRecord("connector", edgeStart));
    }
    this.expect(TokenKind.RBrace);
    const id = `application-connectors#${(this.edgeSeq += 1)}`;
    return { kind: DeclKind.Instance, concept: "application-connectors", id, binds: null, isClass: false, instanceOf: null, assignments: [], children, annotations: [], span: this.spanFrom(start) };
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
    if (this.check(TokenKind.Amp)) {
      const ampTok = this.advance();
      const ref = this.parseDottedPath();
      const endTok = this.tokens[this.pos > 0 ? this.pos - 1 : 0] ?? ampTok;
      return { kind: ValueKind.Ref, ref, span: {
        uri: this.uri,
        start: { line: ampTok.line, column: ampTok.column },
        end: { line: endTok.endLine, column: endTok.endColumn },
      } };
    }
    if (this.match(TokenKind.LBracket)) {
      const items: ValueNode[] = [];
      if (!this.check(TokenKind.RBracket)) {
        items.push(this.parseValue());
        while (this.match(TokenKind.Comma)) {
          if (this.check(TokenKind.RBracket)) break; // trailing comma
          items.push(this.parseValue());
        }
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
      if (this.check(TokenKind.Dot)) {
        // A dotted bare name — a taxonomy-qualified term ref (`taxonomy.term`).
        const parts = [first];
        while (this.match(TokenKind.Dot)) parts.push(this.expectIdentifier());
        return { kind: ValueKind.Name, name: parts.join(".") };
      }
      return { kind: ValueKind.Name, name: first };
    }
    throw this.error(`expected a value`);
  }

  private parsePrimitive(start: Token): PrimitiveDecl {
    this.expectKeyword("primitive");
    const nameTok = this.expect(TokenKind.Identifier);
    const name = nameTok.value;
    const base = this.match(TokenKind.Colon) ? this.expectIdentifier() : null;

    let description = "";
    let regex: string | null = null;
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const [key, value] = this.readStringMember();
      if (key === "description") description = value ?? "";
      else if (key === "regex") regex = value;
    }
    this.expect(TokenKind.RBrace);
    const decl: PrimitiveDecl = { kind: DeclKind.Primitive, name, base, description, regex, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    return decl;
  }

  private parseTaxonomy(start: Token): TaxonomyDecl {
    this.expectKeyword("taxonomy");
    const nameTok = this.expect(TokenKind.Identifier);
    const name = nameTok.value;
    this.expect(TokenKind.Colon);
    this.expectKeyword("represents");
    const represents: string[] = [];
    const representsSpans: SourceSpan[] = [];
    const pushTarget = (): void => {
      const t = this.expect(TokenKind.Identifier);
      represents.push(t.value);
      representsSpans.push(tokenSpan(t, this.uri));
    };
    pushTarget();
    while (this.match(TokenKind.Comma)) pushTarget();
    let description = "";
    const terms: Term[] = [];
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      // Checked before tryParseTerm: `annotate` lexes as an identifier, so
      // `annotate icon {` would otherwise match the concept-led-term lookahead
      // (`<identifier> <identifier> {`) and be mis-parsed as a term.
      if (this.checkKeyword("annotate")) {
        annotations.push(this.parseAnnotationApplication(this.startToken()));
        continue;
      }
      const term = this.tryParseTerm();
      if (term !== null) {
        terms.push(term);
      } else {
        const [key, value] = this.readStringMember();
        if (key === "description" && value !== null) description = value;
      }
    }
    this.expect(TokenKind.RBrace);
    const decl: TaxonomyDecl = { kind: DeclKind.Taxonomy, name, represents, representsSpans, description, terms, annotations, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    return decl;
  }

  /**
   * A term at the head of the cursor, or `null` if the next member is not a term
   * (e.g. a `description = "…"` assignment). Two forms:
   *   - `term <id> { … }`            — the single-concept alias (concept = null)
   *   - `<concept> <id> { … }`       — concept-led (a class of `<concept>`)
   * The concept-led form is recognised by `<identifier> <identifier> {`.
   */
  private tryParseTerm(): Term | null {
    if (this.checkKeyword("term")) return this.parseTerm(null);
    if (this.check(TokenKind.Identifier) && this.peekKind(1) === TokenKind.Identifier) {
      const concept = this.expectIdentifier();
      return this.parseTerm(concept);
    }
    return null;
  }

  // Parse a term row (the leading `term` keyword or `<concept>` is already
  // consumed; `concept` is null for the `term` alias). A term is a class of its
  // concept: its body mixes `name = value;` assignments (its fixed field values)
  // and nested term rows, distinguished from assignments by the same lookahead
  // at every depth.
  private parseTerm(concept: string | null): Term {
    const start = this.startToken();
    if (concept === null) this.expectKeyword("term");
    const idTok = this.expect(TokenKind.Identifier);
    const id = idTok.value;
    const assignments: AssignmentNode[] = [];
    const children: Term[] = [];
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      if (this.checkKeyword("annotate")) {
        annotations.push(this.parseAnnotationApplication(this.startToken()));
        continue;
      }
      const child = this.tryParseTerm();
      if (child !== null) {
        children.push(child);
      } else {
        const memberStart = this.startToken();
        const name = this.expectIdentifier();
        this.expect(TokenKind.Equals);
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        assignments.push({ name, value, span: this.spanFrom(memberStart) });
      }
    }
    this.expect(TokenKind.RBrace);
    const term: Term = { id, concept, assignments, children, annotations, span: this.spanFrom(start) };
    term.idSpan = tokenSpan(idTok, this.uri);
    return term;
  }

  private parseConcept(start: Token): ConceptDecl {
    this.expectKeyword("concept");
    const nameTok = this.expect(TokenKind.Identifier);
    const name = nameTok.value;
    let extendsName: string | null = null;
    let extendsSpan: SourceSpan | undefined;
    if (this.match(TokenKind.Colon)) {
      const t = this.expect(TokenKind.Identifier);
      extendsName = t.value;
      extendsSpan = tokenSpan(t, this.uri);
    }

    let description = "";
    const fields: FieldDecl[] = [];
    const relationships: RelationshipDecl[] = [];
    const invariants: InvariantDecl[] = [];
    const annotations: AnnotationApplication[] = [];

    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      if (this.checkKeyword("relationship")) {
        relationships.push(this.parseRelationship());
      } else if (this.checkKeyword("invariant")) {
        invariants.push(this.parseInvariant());
      } else if (this.checkKeyword("annotate")) {
        annotations.push(this.parseAnnotationApplication(this.startToken()));
      } else if (this.checkKeyword("authoring")) {
        // Doc-only authoring-form blocks (`authoring list-form { … }`) carry no
        // schema; skip them.
        this.advance();
        this.expectIdentifier();
        this.skipBracedBlock();
      } else {
        const nameTok = this.expect(TokenKind.Identifier);
        const memberName = nameTok.value;
        if (this.match(TokenKind.Colon)) {
          const typeTok = this.expect(TokenKind.Identifier);
          const cardinality = this.parseCardinality();
          this.expect(TokenKind.Semicolon);
          fields.push({
            name: memberName, type: typeTok.value, cardinality,
            nameSpan: tokenSpan(nameTok, this.uri), typeSpan: tokenSpan(typeTok, this.uri),
          });
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
    const decl: ConceptDecl = { kind: DeclKind.Concept, name, extends: extendsName, description, fields, relationships, invariants, annotations, span: this.spanFrom(start) };
    if (extendsSpan !== undefined) decl.extendsSpan = extendsSpan;
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    return decl;
  }

  private parseRelationship(): RelationshipDecl {
    this.expectKeyword("relationship");
    const nameTok = this.expect(TokenKind.Identifier);
    this.expect(TokenKind.Arrow);
    const targetTok = this.expect(TokenKind.Identifier);
    const cardinality = this.parseCardinality();
    this.expect(TokenKind.Semicolon);
    return {
      name: nameTok.value, target: targetTok.value, cardinality,
      nameSpan: tokenSpan(nameTok, this.uri), targetSpan: tokenSpan(targetTok, this.uri),
    };
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

  /**
   * Read a `key = <value>;` member. String/number values are returned; any
   * other value (a doc-only `references = [ … ]` list) is skipped and returned
   * as `null`, so callers ignore members they don't recognise.
   */
  private readStringMember(): [string, string | null] {
    const key = this.expectIdentifier();
    this.expect(TokenKind.Equals);
    let value: string | null = null;
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString) || this.check(TokenKind.Number)) {
      value = this.advance().value;
    } else {
      this.skipToSemicolon();
    }
    this.expect(TokenKind.Semicolon);
    return [key, value];
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

  /** A record id token — a bare identifier or a quoted string (e.g. `sequence "…"`). */
  private expectRecordIdTok(): Token {
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString)) {
      return this.advance();
    }
    return this.expect(TokenKind.Identifier);
  }

  private error(message: string): ParseError {
    const token = this.current();
    const got = token.value.length > 0 ? token.value : token.kind;
    return new ParseError(`${message} at ${token.line}:${token.column} (got "${got}")`, token);
  }
}

const EOF_TOKEN: Token = { kind: TokenKind.EOF, value: "", line: 0, column: 0, endLine: 0, endColumn: 0 };
