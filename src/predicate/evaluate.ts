/**
 * Evaluator for the predicate / derivation AST (design spec §4) over a
 * {@link Model}. Node-ish values are `Set<NodeId>` (a bare node is a singleton
 * set), scalars are themselves, and `none` is `null`. `evaluate` returns the
 * raw value (a set for comprehensions); `satisfies` coerces to boolean.
 */

import type { Model } from "../model/model.js";
import { EdgeKind, Direction, type NodeId } from "../model/graph.js";
import { ExprKind, BinaryOp, QuantifierKind, type Expr } from "./ast.js";

export type EvalValue = boolean | string | number | Set<NodeId> | null;

interface Env {
  self: NodeId;
  vars: Map<string, NodeId>;
}

export function evaluate(model: Model, expr: Expr, self: NodeId): EvalValue {
  return evalExpr(model, expr, { self, vars: new Map() });
}

export function satisfies(model: Model, expr: Expr, self: NodeId): boolean {
  return toBool(evaluate(model, expr, self));
}

function evalExpr(model: Model, expr: Expr, env: Env): EvalValue {
  switch (expr.kind) {
    case ExprKind.This:
      return new Set([env.self]);

    case ExprKind.Var: {
      const id = env.vars.get(expr.name);
      if (id === undefined) {
        throw new Error(`unbound variable "${expr.name}"`);
      }
      return new Set([id]);
    }

    case ExprKind.None:
      return null;

    case ExprKind.Member:
      return evalMember(model, evalExpr(model, expr.target, env), expr.member);

    case ExprKind.Comprehension: {
      const result = new Set<NodeId>();
      for (const instance of model.instancesOf(expr.concept)) {
        if (toBool(evalExpr(model, expr.body, bind(env, expr.variable, instance)))) {
          result.add(instance);
        }
      }
      return result;
    }

    case ExprKind.Quantifier: {
      const instances = model.instancesOf(expr.concept);
      const holds = (instance: NodeId): boolean =>
        toBool(evalExpr(model, expr.body, bind(env, expr.variable, instance)));
      return expr.quantifier === QuantifierKind.All ? instances.every(holds) : instances.some(holds);
    }

    case ExprKind.Binary:
      return evalBinary(model, expr.op, expr.left, expr.right, env);

    case ExprKind.Unary:
      return !toBool(evalExpr(model, expr.operand, env));
  }
}

function evalBinary(model: Model, op: BinaryOp, leftExpr: Expr, rightExpr: Expr, env: Env): EvalValue {
  // Short-circuit the logical connectives.
  if (op === BinaryOp.And) {
    return toBool(evalExpr(model, leftExpr, env)) && toBool(evalExpr(model, rightExpr, env));
  }
  if (op === BinaryOp.Or) {
    return toBool(evalExpr(model, leftExpr, env)) || toBool(evalExpr(model, rightExpr, env));
  }
  if (op === BinaryOp.Implies) {
    return !toBool(evalExpr(model, leftExpr, env)) || toBool(evalExpr(model, rightExpr, env));
  }

  const left = evalExpr(model, leftExpr, env);
  const right = evalExpr(model, rightExpr, env);
  switch (op) {
    case BinaryOp.Eq:
      return valuesEqual(left, right);
    case BinaryOp.Neq:
      return !valuesEqual(left, right);
    case BinaryOp.In:
      return isSubset(asNodeSet(left), asNodeSet(right));
    default:
      throw new Error(`unhandled binary operator ${BinaryOp[op]}`);
  }
}

/** Field access: a scalar attr on a single node, else the union of relationship targets. */
function evalMember(model: Model, target: EvalValue, name: string): EvalValue {
  const nodes = asNodeSet(target);
  if (nodes.size === 1) {
    const only = firstOf(nodes);
    const scalar = only === undefined ? undefined : model.resolve(only)?.attrs.get(name);
    if (scalar !== undefined) {
      return scalar;
    }
  }
  const result = new Set<NodeId>();
  for (const node of nodes) {
    for (const targetId of model.related(node, EdgeKind.Relationship, Direction.Out, name)) {
      result.add(targetId);
    }
  }
  return result;
}

function bind(env: Env, name: string, id: NodeId): Env {
  return { self: env.self, vars: new Map(env.vars).set(name, id) };
}

function asNodeSet(value: EvalValue): Set<NodeId> {
  return value instanceof Set ? value : new Set<NodeId>();
}

function isEmpty(value: EvalValue): boolean {
  return value === null || (value instanceof Set && value.size === 0);
}

function valuesEqual(a: EvalValue, b: EvalValue): boolean {
  if (a === null || b === null) {
    return isEmpty(a) && isEmpty(b);
  }
  if (a instanceof Set && b instanceof Set) {
    return a.size === b.size && [...a].every((x) => b.has(x));
  }
  return a === b;
}

function isSubset(a: Set<NodeId>, b: Set<NodeId>): boolean {
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

function toBool(value: EvalValue): boolean {
  if (typeof value === "boolean") return value;
  if (value === null) return false;
  if (value instanceof Set) return value.size > 0;
  if (typeof value === "number") return value !== 0;
  return value.length > 0;
}

function firstOf(set: Set<NodeId>): NodeId | undefined {
  for (const value of set) {
    return value;
  }
  return undefined;
}
