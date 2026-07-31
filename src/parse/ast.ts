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
}

export enum ValueKind {
  String,
  Name,
  Ref,
  List,
  Composite,
}

export interface StringValue {
  kind: ValueKind.String;
  text: string;
}

/** A bare identifier value — an enum member (`service`). */
export interface NameValue {
  kind: ValueKind.Name;
  name: string;
}

/** A `&`-prefixed record reference. */
export interface RefValue {
  kind: ValueKind.Ref;
  ref: string;
  /** Span of the `&name` reference occurrence (set by the parser). */
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
  | RefValue
  | ListValue
  | CompositeValue;

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

export type Declaration = ConceptDecl | TaxonomyDecl | PrimitiveDecl | InstanceDecl | ModelDecl;

export interface NamespaceNode {
  path: string;
  imports: string[];
  declarations: Declaration[];
  span: SourceSpan;
  /** Span of each `import <path>` path, parallel to `imports`. */
  importSpans?: SourceSpan[];
}
