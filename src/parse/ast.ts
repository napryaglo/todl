/**
 * Parse AST for the TODL surface (design spec §3). Distinct from the runtime
 * graph model — the loader (a later step) walks this tree to build a Model.
 * Cardinality reuses the model enum. Invariant predicates are captured as raw
 * token slices here; the predicate parser turns them into expression ASTs.
 */

import type { Token } from "./lexer.js";
import type { Cardinality } from "../model/graph.js";

export enum DeclKind {
  Primitive,
  Enum,
  Concept,
  Instance,
}

export enum ValueKind {
  String,
  Name,
  Ref,
  List,
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
}

export interface ListValue {
  kind: ValueKind.List;
  items: ValueNode[];
}

export type ValueNode = StringValue | NameValue | RefValue | ListValue;

export interface AssignmentNode {
  name: string;
  value: ValueNode;
}

export interface InstanceDecl {
  kind: DeclKind.Instance;
  concept: string;
  id: string;
  assignments: AssignmentNode[];
}

export interface FieldDecl {
  name: string;
  type: string;
  cardinality: Cardinality;
}

export interface RelationshipDecl {
  name: string;
  target: string;
  cardinality: Cardinality;
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
}

export interface EnumCase {
  id: string;
  label: string;
  description: string;
}

export interface EnumDecl {
  kind: DeclKind.Enum;
  name: string;
  description: string;
  cases: EnumCase[];
}

export interface PrimitiveDecl {
  kind: DeclKind.Primitive;
  name: string;
  base: string | null;
  description: string;
  regex: string | null;
}

export type Declaration = ConceptDecl | EnumDecl | PrimitiveDecl | InstanceDecl;

export interface NamespaceNode {
  path: string;
  imports: string[];
  declarations: Declaration[];
}
