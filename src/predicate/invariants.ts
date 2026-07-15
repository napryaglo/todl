/**
 * Registry of concept invariants (design spec §4.3, §6). An invariant is a
 * boolean predicate that must hold for every instance of its concept. The
 * validator runs them per instance (including inherited concepts).
 *
 * Registered here rather than stored as graph nodes because a predicate is an
 * expression AST, not a scalar. When the surface parser lands, authored
 * invariants will register through this same path.
 */

import type { Expr } from "./ast.js";
import type { NodeId } from "../model/graph.js";

export interface InvariantDef {
  concept: NodeId;
  expr: Expr;
  description: string;
}

export class Invariants {
  private readonly byConcept = new Map<NodeId, InvariantDef[]>();

  define(concept: NodeId, expr: Expr, description: string): void {
    const definition: InvariantDef = { concept, expr, description };
    const existing = this.byConcept.get(concept);
    if (existing === undefined) {
      this.byConcept.set(concept, [definition]);
    } else {
      existing.push(definition);
    }
  }

  for(concept: NodeId): InvariantDef[] {
    return this.byConcept.get(concept) ?? [];
  }
}
