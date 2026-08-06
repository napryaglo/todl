/**
 * Parse AST for the TODL surface (design spec §3). Distinct from the runtime
 * graph model — the loader (a later step) walks this tree to build a Repository.
 * Cardinality reuses the model enum. Invariant predicates are captured as raw
 * token slices here; the predicate parser turns them into expression ASTs.
 */

import type { Token } from "./lexer.js";
import type { Cardinality } from "../model/graph.js";
import type { SourceSpan } from "../diagnostics/span.js";

export enum DeclKind {
  Primitive,
  Taxonomy,
  Concept,
  Instance,
  Model,
  Annotation,
  Package,
}

export enum ValueKind {
  String,
  Name,
  List,
  Composite,
  Boolean,
}

export interface StringValue {
  kind: ValueKind.String;
  text: string;
}

/** A boolean literal — the reserved words `true` / `false`. */
export interface BooleanValue {
  kind: ValueKind.Boolean;
  value: boolean;
}

/** A bare identifier value — an enum member (`service`) or, when the member's
 * declared type is a concept/taxonomy, a reference. */
export interface NameValue {
  kind: ValueKind.Name;
  name: string;
  /** Span of the name occurrence (set by the parser) — used for reference
   * resolution diagnostics and go-to-definition on reference values. */
  span?: SourceSpan;
}

export interface ListValue {
  kind: ValueKind.List;
  items: ValueNode[];
}

/** A `|`-composed set of enum-flag members, e.g. `physical | on-premises`. */
export interface CompositeValue {
  kind: ValueKind.Composite;
  parts: string[];
}

export type ValueNode =
  | StringValue
  | NameValue
  | ListValue
  | CompositeValue
  | BooleanValue;

export interface AssignmentNode {
  name: string;
  value: ValueNode;
  /** Source span of `name = value` — set for authored assignments; absent for synthesized ones (edge-record from/to/operator). */
  span?: SourceSpan;
}

export interface InstanceDecl {
  kind: DeclKind.Instance;
  concept: string;
  id: string;
  /** Optional `: <meta-model>` binding on a container record (`model m : ea`). */
  binds: string | null;
  /** `true` when declared with the `class` modifier — a partial, fixed-value definition. */
  isClass: boolean;
  /** The class this leaf instantiates (`instanceof <class>`), or null. */
  instanceOf: string | null;
  assignments: AssignmentNode[];
  /** Nested records declared inside this instance's body (containment). */
  children: InstanceDecl[];
  /** `annotate` applications in this record's body. Staged only for classes;
   * on a concrete instance the loader reports `annotation.invalid-target`. */
  annotations: AnnotationApplication[];
  span: SourceSpan;
  /** Span of the leading concept identifier (`<concept> <id>`). */
  conceptSpan?: SourceSpan;
  /** Span of the `instanceof <class>` class identifier, when present. */
  instanceOfSpan?: SourceSpan;
  /** Span of the record's id identifier. */
  idSpan?: SourceSpan;
}

export interface ModelDecl {
  kind: DeclKind.Model;
  id: string;
  /** The bound meta-model (`: <meta-model>`) — required. */
  metaModel: string;
  /** The `uses <lib>, …` library list; empty when omitted. */
  libraries: string[];
  /** The concrete objects this model carries. */
  instances: InstanceDecl[];
  span: SourceSpan;
  idSpan?: SourceSpan;
  metaModelSpan?: SourceSpan;
  /** Span of each `uses` library identifier, parallel to `libraries`. */
  librarySpans?: SourceSpan[];
}

export interface AnnotationApplication {
  /** The annotation being applied. */
  name: string;
  /** Fixed `param = value` param assignments. */
  assignments: AssignmentNode[];
  span: SourceSpan;
  nameSpan?: SourceSpan;
}

export interface AnnotationDecl {
  kind: DeclKind.Annotation;
  name: string;
  /** The base annotation this one extends (`annotation Sub : Base`), or null. */
  extends: string | null;
  extendsSpan?: SourceSpan;
  /** Typed params, reusing FieldDecl (name / type / cardinality). */
  params: FieldDecl[];
  span: SourceSpan;
  nameSpan?: SourceSpan;
}

export interface PackageDecl {
  kind: DeclKind.Package;
  annotations: AnnotationApplication[];
  span: SourceSpan;
}

export interface FieldDecl {
  name: string;
  type: string;
  cardinality: Cardinality;
  nameSpan?: SourceSpan;
  typeSpan?: SourceSpan;
}

export interface RelationshipDecl {
  name: string;
  target: string;
  cardinality: Cardinality;
  nameSpan?: SourceSpan;
  targetSpan?: SourceSpan;
}

export interface InvariantDecl {
  description: string;
  /** Raw tokens of the `predicate = …` expression, or `null` for prose-only invariants. */
  predicate: Token[] | null;
}

export interface ConceptDecl {
  kind: DeclKind.Concept;
  name: string;
  extends: string | null;
  description: string;
  fields: FieldDecl[];
  relationships: RelationshipDecl[];
  invariants: InvariantDecl[];
  annotations: AnnotationApplication[];
  span: SourceSpan;
  /** Span of the `extends` parent identifier (`: <parent>`), when present. */
  extendsSpan?: SourceSpan;
  /** Span of the concept's name identifier. */
  nameSpan?: SourceSpan;
}

export interface Term {
  id: string;
  /** The concept this term is a class of, from the leading keyword
   * (`location azure { }`). `null` for the bare `term` alias, valid only when
   * the taxonomy represents exactly one concept. */
  concept: string | null;
  /** The term's fixed field values — it is a class of its concept. */
  assignments: AssignmentNode[];
  children: Term[];
  /** `annotate` applications on this term (a term is a class of its concept). */
  annotations: AnnotationApplication[];
  span: SourceSpan;
  /** Span of the term's id identifier. */
  idSpan?: SourceSpan;
}

export interface TaxonomyDecl {
  kind: DeclKind.Taxonomy;
  name: string;
  /** The concepts this taxonomy represents (`taxonomy X : represents C1, C2`). */
  represents: string[];
  /** Span of each `represents` target identifier, parallel to `represents`.
   * Absent when the parse predates span capture. */
  representsSpans?: SourceSpan[];
  description: string;
  terms: Term[];
  /** `annotate` applications on the taxonomy itself (decorate the taxonomy
   * node, e.g. a taxonomy-wide icon), distinct from its terms' annotations. */
  annotations: AnnotationApplication[];
  /** The `uses <tax>, …` list of other taxonomies whose terms are in bare
   * scope for this taxonomy's term-body references; empty when omitted. */
  uses: string[];
  /** Span of each `uses` target identifier, parallel to `uses`. */
  usesSpans?: SourceSpan[];
  span: SourceSpan;
  /** Span of the taxonomy's name identifier. */
  nameSpan?: SourceSpan;
}

export interface PrimitiveDecl {
  kind: DeclKind.Primitive;
  name: string;
  base: string | null;
  description: string;
  regex: string | null;
  span: SourceSpan;
  /** Span of the primitive's name identifier. */
  nameSpan?: SourceSpan;
}

export type Declaration =
  | ConceptDecl | TaxonomyDecl | PrimitiveDecl | InstanceDecl | ModelDecl
  | AnnotationDecl | PackageDecl;

export interface NamespaceNode {
  path: string;
  imports: string[];
  declarations: Declaration[];
  span: SourceSpan;
  /** Span of each `import <path>` path, parallel to `imports`. */
  importSpans?: SourceSpan[];
}
