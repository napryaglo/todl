/**
 * The predicate / derivation expression AST (design spec §4). A small, total
 * language: traversal, set algebra, quantifiers, comprehensions — evaluated
 * over the graph by {@link ../evaluate}. The text parser for these expressions
 * comes later, with the main surface parser; this module is the shape the
 * evaluator consumes and that tests build directly.
 *
 * Node kinds and operators are enums (never string-literal discriminants).
 */

import type { NodeId } from "../model/graph.js";

export enum ExprKind {
  This,
  Var,
  Name,
  None,
  Member,
  Comprehension,
  Quantifier,
  Binary,
  Unary,
}

export enum BinaryOp {
  And,
  Or,
  Implies,
  Eq,
  Neq,
  In,
}

export enum UnaryOp {
  Not,
}

export enum QuantifierKind {
  All,
  Any,
}

export interface ThisExpr {
  kind: ExprKind.This;
}

export interface VarExpr {
  kind: ExprKind.Var;
  name: string;
}

/** A bare reference to a node by id — an enum member (`service`) or a record (`&x`). */
export interface NameExpr {
  kind: ExprKind.Name;
  id: NodeId;
}

export interface NoneExpr {
  kind: ExprKind.None;
}

export interface MemberExpr {
  kind: ExprKind.Member;
  target: Expr;
  member: string;
}

export interface ComprehensionExpr {
  kind: ExprKind.Comprehension;
  variable: string;
  concept: NodeId;
  body: Expr;
}

export interface QuantifierExpr {
  kind: ExprKind.Quantifier;
  quantifier: QuantifierKind;
  variable: string;
  concept: NodeId;
  body: Expr;
}

export interface BinaryExpr {
  kind: ExprKind.Binary;
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export interface UnaryExpr {
  kind: ExprKind.Unary;
  op: UnaryOp;
  operand: Expr;
}

export type Expr =
  | ThisExpr
  | VarExpr
  | NameExpr
  | NoneExpr
  | MemberExpr
  | ComprehensionExpr
  | QuantifierExpr
  | BinaryExpr
  | UnaryExpr;

// ── Constructors (keep predicate expressions readable) ────────────────────

export const THIS: ThisExpr = { kind: ExprKind.This };
export const NONE: NoneExpr = { kind: ExprKind.None };

export function variable(name: string): VarExpr {
  return { kind: ExprKind.Var, name };
}

export function name(id: NodeId): NameExpr {
  return { kind: ExprKind.Name, id };
}

export function member(target: Expr, name: string): MemberExpr {
  return { kind: ExprKind.Member, target, member: name };
}

export function comprehension(name: string, concept: NodeId, body: Expr): ComprehensionExpr {
  return { kind: ExprKind.Comprehension, variable: name, concept, body };
}

export function all(name: string, concept: NodeId, body: Expr): QuantifierExpr {
  return { kind: ExprKind.Quantifier, quantifier: QuantifierKind.All, variable: name, concept, body };
}

export function any(name: string, concept: NodeId, body: Expr): QuantifierExpr {
  return { kind: ExprKind.Quantifier, quantifier: QuantifierKind.Any, variable: name, concept, body };
}

export function and(left: Expr, right: Expr): BinaryExpr {
  return { kind: ExprKind.Binary, op: BinaryOp.And, left, right };
}

export function or(left: Expr, right: Expr): BinaryExpr {
  return { kind: ExprKind.Binary, op: BinaryOp.Or, left, right };
}

export function implies(left: Expr, right: Expr): BinaryExpr {
  return { kind: ExprKind.Binary, op: BinaryOp.Implies, left, right };
}

export function eq(left: Expr, right: Expr): BinaryExpr {
  return { kind: ExprKind.Binary, op: BinaryOp.Eq, left, right };
}

export function neq(left: Expr, right: Expr): BinaryExpr {
  return { kind: ExprKind.Binary, op: BinaryOp.Neq, left, right };
}

export function isIn(left: Expr, right: Expr): BinaryExpr {
  return { kind: ExprKind.Binary, op: BinaryOp.In, left, right };
}

export function not(operand: Expr): UnaryExpr {
  return { kind: ExprKind.Unary, op: UnaryOp.Not, operand };
}
