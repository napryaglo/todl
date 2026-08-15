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
  type ViewpointDecl,
  type InstanceDecl,
  type ModelDecl,
  type AnnotationDecl,
  type AnnotationApplication,
  type PackageDecl,
  type OperatorDecl,
  type EdgeApplication,
  type AssignmentNode,
  type ValueNode,
  type ObjectValue,
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
    if (this.checkKeyword("viewpoint")) return this.parseViewpoint(start);
    if (this.checkKeyword("concept")) return this.parseConcept(start);
    if (this.checkKeyword("model")) return this.parseModel(start);
    if (this.checkKeyword("annotation")) return this.parseAnnotation(start);
    if (this.checkKeyword("package")) return this.parsePackage(start);
    if (this.checkKeyword("operator")) return this.parseOperator(start);
    if (this.checkKeyword("class")) {
      this.advance(); // class modifier
      return this.parseInstanceFrom(this.expectIdentifier(), start, true);
    }
    if (this.check(TokenKind.Identifier)) {
      const cStart = this.current();
      const concept = this.parseDottedPath();           // record concept may be ns-qualified
      return this.parseInstanceFrom(concept, start, false, this.spanFrom(cStart));
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
      // The class/term may be namespace-qualified; resolution strips the ns.
      const startTok = this.current();
      instanceOf = this.parseDottedPath();
      instanceOfSpan = this.spanFrom(startTok);
    }
    const binds = this.match(TokenKind.Colon) ? this.expectIdentifier() : null;
    this.expect(TokenKind.LBrace);
    const { assignments, children, annotations, edges } = this.parseRecordBody();
    this.expect(TokenKind.RBrace);
    const decl: InstanceDecl = { kind: DeclKind.Instance, concept, id, binds, isClass, instanceOf, assignments, children, annotations, edges, span: this.spanFrom(start) };
    if (conceptSpan !== undefined) decl.conceptSpan = conceptSpan;
    if (instanceOfSpan !== undefined) decl.instanceOfSpan = instanceOfSpan;
    decl.idSpan = tokenSpan(idTok, this.uri);
    return decl;
  }

  /** Parse a record body (between `{` and `}`, both consumed by the caller):
   * annotate applications, `name = value` assignments, edge applications
   * (`a <glyph> b`), and nested named records. Shared by instance records and
   * inline objects. */
  private parseRecordBody(): {
    assignments: AssignmentNode[];
    children: InstanceDecl[];
    annotations: AnnotationApplication[];
    edges: EdgeApplication[];
  } {
    const assignments: AssignmentNode[] = [];
    const children: InstanceDecl[] = [];
    const annotations: AnnotationApplication[] = [];
    const edges: EdgeApplication[] = [];
    while (!this.check(TokenKind.RBrace)) {
      const memberStart = this.startToken();
      if (this.checkKeyword("annotate")) { annotations.push(this.parseAnnotationApplication(memberStart)); continue; }
      if (this.edgeApplicationAhead()) { edges.push(this.parseEdgeApplication(memberStart)); continue; }
      const first = this.expectIdentifier();
      if (this.match(TokenKind.Equals)) {
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        assignments.push({ name: first, value, span: this.spanFrom(memberStart) });
      } else {
        children.push(this.parseInstanceFrom(first, memberStart));
      }
    }
    return { assignments, children, annotations, edges };
  }

  /** True when the tokens ahead form `Identifier ( . Identifier )* {` — a typed
   * inline object, distinct from a bare name value. */
  private objectAhead(): boolean {
    let i = 0;
    if (this.peekKind(i) !== TokenKind.Identifier) return false;
    i += 1;
    while (this.peekKind(i) === TokenKind.Dot && this.peekKind(i + 1) === TokenKind.Identifier) i += 2;
    return this.peekKind(i) === TokenKind.LBrace;
  }

  private parseInlineObject(start: Token): ObjectValue {
    const cStart = this.current();
    const concept = this.parseDottedPath();
    const conceptSpan = this.spanFrom(cStart);
    this.expect(TokenKind.LBrace);
    const { assignments, children, annotations, edges } = this.parseRecordBody();
    this.expect(TokenKind.RBrace);
    return { kind: ValueKind.Object, concept, assignments, children, annotations, edges, conceptSpan, span: this.spanFrom(start) };
  }

  /**
   * Parse a model: `model <id> : <meta-model> [uses <lib>, …] { <objects> }`.
   * The body reuses instance-record parsing for each contained object.
   */
  private parseModel(start: Token): ModelDecl {
    this.expectKeyword("model");
    const idTok = this.expect(TokenKind.Identifier);
    this.expect(TokenKind.Colon);
    // Model bindings are NAMESPACE names, which may be dotted
    // (`libraries.microsoft`, `adl.meta.model`) — accept a dotted path, not a
    // single identifier. A bare name still parses (single-segment path).
    const metaStart = this.current();
    const metaModel = this.parseDottedPath();
    const metaModelSpan = this.spanFrom(metaStart);
    const libraries: string[] = [];
    const librarySpans: SourceSpan[] = [];
    if (this.checkKeyword("uses")) {
      this.advance();
      do {
        const libStart = this.current();
        libraries.push(this.parseDottedPath());
        librarySpans.push(this.spanFrom(libStart));
      } while (this.match(TokenKind.Comma));
    }
    let conforms: string | null = null;
    let conformsSpan: SourceSpan | undefined;
    if (this.checkKeyword("conforms")) {
      this.advance();
      const cStart = this.current();
      conforms = this.parseDottedPath();   // viewpoint may be ns-qualified
      conformsSpan = this.spanFrom(cStart);
    }
    const instances: InstanceDecl[] = [];
    const edges: EdgeApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const memberStart = this.startToken();
      if (this.edgeApplicationAhead()) {
        edges.push(this.parseEdgeApplication(memberStart));
        continue;
      }
      const cStart = this.current();
      const concept = this.parseDottedPath();           // record concept may be ns-qualified
      instances.push(this.parseInstanceFrom(concept, memberStart, false, this.spanFrom(cStart)));
    }
    this.expect(TokenKind.RBrace);
    const decl: ModelDecl = {
      kind: DeclKind.Model,
      id: idTok.value,
      metaModel,
      libraries,
      instances,
      edges,
      conforms,
      span: this.spanFrom(start),
    };
    decl.idSpan = tokenSpan(idTok, this.uri);
    decl.metaModelSpan = metaModelSpan;
    if (librarySpans.length > 0) decl.librarySpans = librarySpans;
    if (conformsSpan !== undefined) decl.conformsSpan = conformsSpan;
    return decl;
  }

  /** `annotation <Name> { <param> : <type><card>; … }` — typed param fields. */
  private parseAnnotation(start: Token): AnnotationDecl {
    this.expectKeyword("annotation");
    const nameTok = this.expect(TokenKind.Identifier);
    // Optional base annotation (`annotation Sub : Base`), same `:` supertyping
    // syntax concepts use. The base may be namespace-qualified.
    let extendsName: string | null = null;
    let extendsSpan: SourceSpan | undefined;
    if (this.match(TokenKind.Colon)) {
      const startTok = this.current();
      extendsName = this.parseDottedPath();
      extendsSpan = this.spanFrom(startTok);
    }
    const params: FieldDecl[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace)) {
      const pNameTok = this.expect(TokenKind.Identifier);
      this.expect(TokenKind.Colon);
      const typeStart = this.current();
      const typeName = this.parseDottedPath();          // param type may be ns-qualified
      const typeSpan = this.spanFrom(typeStart);
      const cardinality = this.parseCardinality();
      this.expect(TokenKind.Semicolon);
      params.push({
        name: pNameTok.value, type: typeName, cardinality,
        nameSpan: tokenSpan(pNameTok, this.uri), typeSpan,
      });
    }
    this.expect(TokenKind.RBrace);
    const decl: AnnotationDecl = { kind: DeclKind.Annotation, name: nameTok.value, extends: extendsName, params, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    if (extendsSpan !== undefined) decl.extendsSpan = extendsSpan;
    return decl;
  }

  /** `annotate <Name> { <param> = <value>; … }` — an application (concept or package body). */
  private parseAnnotationApplication(start: Token): AnnotationApplication {
    this.expectKeyword("annotate");
    const nameStart = this.current();
    const name = this.parseDottedPath();                // applied annotation may be ns-qualified
    const nameSpan = this.spanFrom(nameStart);
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
    const app: AnnotationApplication = { name, assignments, span: this.spanFrom(start) };
    app.nameSpan = nameSpan;
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

  /** `operator <glyph> : <concept> (<from>, <to>);`  (reified edge) or
   *  `operator <glyph> : <concept>.<relationship>;`   (relationship member). */
  private parseOperator(start: Token): OperatorDecl {
    this.expectKeyword("operator");
    const glyphTok = this.expect(TokenKind.SymbolOp);
    this.expect(TokenKind.Colon);
    const conceptStart = this.current();
    const path = this.parseDottedPath();               // `connector` or `component.depends_on`
    let concept = path;
    let relationship: string | null = null;
    let fromMember: string | null = null;
    let toMember: string | null = null;
    if (this.match(TokenKind.LParen)) {                // reified form: (from, to)
      fromMember = this.expectIdentifier();
      this.expect(TokenKind.Comma);
      toMember = this.expectIdentifier();
      this.expect(TokenKind.RParen);
    } else {                                           // relationship form: split last segment
      const dot = path.lastIndexOf(".");
      if (dot < 0) throw this.error(`operator "${glyphTok.value}" needs endpoints "(from, to)" or a "concept.relationship" target`);
      concept = path.slice(0, dot);
      relationship = path.slice(dot + 1);
    }
    this.expect(TokenKind.Semicolon);
    const decl: OperatorDecl = {
      kind: DeclKind.Operator, glyph: glyphTok.value, concept, fromMember, toMember, relationship,
      span: this.spanFrom(start),
    };
    decl.glyphSpan = tokenSpan(glyphTok, this.uri);
    decl.conceptSpan = this.spanFrom(conceptStart);
    return decl;
  }

  /**
   * Parse an edge application `<left> <glyph> <right> [ { … } | ; ]`, leading
   * operand NOT yet consumed. Shape-only: the loader resolves the glyph against
   * the operator table and materializes the edge (design §3).
   */
  private parseEdgeApplication(start: Token): EdgeApplication {
    const leftStart = this.current();
    const left = this.parseDottedPath();
    const glyphTok = this.expect(TokenKind.SymbolOp);
    const rightStart = this.current();
    const right = this.parseDottedPath();
    const body: AssignmentNode[] = [];
    if (this.match(TokenKind.LBrace)) {
      while (!this.check(TokenKind.RBrace)) {
        const aStart = this.startToken();
        const name = this.expectIdentifier();
        this.expect(TokenKind.Equals);
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        body.push({ name, value, span: this.spanFrom(aStart) });
      }
      this.expect(TokenKind.RBrace);
      this.match(TokenKind.Semicolon); // optional trailing `;` after a body
    } else {
      this.expect(TokenKind.Semicolon);
    }
    const edge: EdgeApplication = { glyph: glyphTok.value, left, right, body, span: this.spanFrom(start) };
    edge.glyphSpan = tokenSpan(glyphTok, this.uri);
    edge.leftSpan = this.spanFrom(leftStart);
    edge.rightSpan = this.spanFrom(rightStart);
    return edge;
  }

  /** True when the tokens ahead form `Identifier ( . Identifier )*` immediately
   * followed by a SymbolOp — an edge application `a <glyph> b`. */
  private edgeApplicationAhead(): boolean {
    let i = 0;
    if (this.peekKind(i) !== TokenKind.Identifier) return false;
    i += 1;
    while (this.peekKind(i) === TokenKind.Dot && this.peekKind(i + 1) === TokenKind.Identifier) i += 2;
    return this.peekKind(i) === TokenKind.SymbolOp;
  }

  private parseValue(): ValueNode {
    if (this.check(TokenKind.Identifier) && this.objectAhead()) {
      return this.parseInlineObject(this.startToken());
    }
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString)) {
      return { kind: ValueKind.String, text: this.advance().value };
    }
    if (this.check(TokenKind.Number)) {
      return { kind: ValueKind.String, text: this.advance().value };
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
      // `true` / `false` are reserved boolean literals — a bare one is always a
      // boolean value (not a name/relationship). A dotted or `|`-composed use
      // (`x.true`, `a | true`) keeps the identifier path below.
      const word = this.current().value;
      if ((word === "true" || word === "false")
          && this.peekKind(1) !== TokenKind.Dot && this.peekKind(1) !== TokenKind.Pipe) {
        this.advance();
        return { kind: ValueKind.Boolean, value: word === "true" };
      }
      const startTok = this.current();
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
        return { kind: ValueKind.Name, name: parts.join("."), span: this.spanFrom(startTok) };
      }
      return { kind: ValueKind.Name, name: first, span: this.spanFrom(startTok) };
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
    // represents / uses targets may be namespace-qualified (`ns.concept`,
    // `ns.taxonomy`); resolution strips the namespace prefix. parseDottedPath
    // accepts a bare name too, so unqualified authoring is unchanged.
    const pushTarget = (): void => {
      const startTok = this.current();
      represents.push(this.parseDottedPath());
      representsSpans.push(this.spanFrom(startTok));
    };
    pushTarget();
    while (this.match(TokenKind.Comma)) pushTarget();
    const uses: string[] = [];
    const usesSpans: SourceSpan[] = [];
    if (this.checkKeyword("uses")) {
      this.advance();
      do {
        const startTok = this.current();
        uses.push(this.parseDottedPath());
        usesSpans.push(this.spanFrom(startTok));
      } while (this.match(TokenKind.Comma));
    }
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
    const decl: TaxonomyDecl = { kind: DeclKind.Taxonomy, name, represents, representsSpans, description, terms, annotations, uses, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    if (usesSpans.length > 0) decl.usesSpans = usesSpans;
    return decl;
  }

  private parseViewpoint(start: Token): ViewpointDecl {
    this.expectKeyword("viewpoint");
    const nameTok = this.expect(TokenKind.Identifier);
    const name = nameTok.value;
    this.expect(TokenKind.Colon);
    this.expectKeyword("frames");
    const frames: string[] = [];
    const framesSpans: SourceSpan[] = [];
    // frames targets may be namespace-qualified (`ns.Concept`); parseDottedPath
    // accepts a bare name too, so unqualified authoring is unchanged.
    const pushTarget = (): void => {
      const startTok = this.current();
      frames.push(this.parseDottedPath());
      framesSpans.push(this.spanFrom(startTok));
    };
    pushTarget();
    while (this.match(TokenKind.Comma)) pushTarget();
    // No body block — a viewpoint has no terms; the declaration ends here.
    const decl: ViewpointDecl = { kind: DeclKind.Viewpoint, name, frames, framesSpans, span: this.spanFrom(start) };
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
      // A parent may be namespace-qualified (`ns.concept`); resolution strips
      // the namespace. Bare names still parse.
      const startTok = this.current();
      extendsName = this.parseDottedPath();
      extendsSpan = this.spanFrom(startTok);
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
          const typeStart = this.current();
          const typeName = this.parseDottedPath();      // field type may be ns-qualified
          const typeSpan = this.spanFrom(typeStart);
          const cardinality = this.parseCardinality();
          this.expect(TokenKind.Semicolon);
          fields.push({
            name: memberName, type: typeName, cardinality,
            nameSpan: tokenSpan(nameTok, this.uri), typeSpan,
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
    this.expectSymbol("->");
    const targetStart = this.current();
    const targets = [this.parseDottedPath()];           // relationship target may be ns-qualified
    const targetSpans = [this.spanFrom(targetStart)];
    while (this.match(TokenKind.Pipe)) {                 // `-> a | b | c` union of target concepts
      const nextStart = this.current();
      targets.push(this.parseDottedPath());
      targetSpans.push(this.spanFrom(nextStart));
    }
    const cardinality = this.parseCardinality();
    const annotations: AnnotationApplication[] = [];
    if (this.match(TokenKind.LBrace)) {
      while (!this.check(TokenKind.RBrace)) {
        if (this.checkKeyword("annotate")) {
          annotations.push(this.parseAnnotationApplication(this.startToken()));
        } else {
          throw this.error('only "annotate" statements are allowed in a relationship body');
        }
      }
      this.expect(TokenKind.RBrace);
    } else {
      this.expect(TokenKind.Semicolon);
    }
    return {
      name: nameTok.value, targets, cardinality, annotations,
      nameSpan: tokenSpan(nameTok, this.uri), targetSpans,
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

  /** True when the current token is a SymbolOp with exactly `value`. */
  private checkSymbol(value: string): boolean {
    const t = this.current();
    return t.kind === TokenKind.SymbolOp && t.value === value;
  }

  private matchSymbol(value: string): boolean {
    if (this.checkSymbol(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expectSymbol(value: string): Token {
    if (!this.checkSymbol(value)) throw this.error(`expected "${value}"`);
    return this.advance();
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
