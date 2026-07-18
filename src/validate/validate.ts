/**
 * Semantic validation (design spec §6) — machine-legible diagnostics an agent
 * can act on. This first phase checks cardinality against each instance's
 * effective (own + inherited) concept schema. Reference resolution is enforced
 * by the store (no dangling edges); relationship target-type and invariant
 * phases layer on in later steps.
 */

import { Tier, EdgeKind, Direction, Cardinality, type NodeId, type Node } from "../model/graph.js";
import type { Model, FieldSchema, RelationshipSchema } from "../model/model.js";
import { satisfies } from "../predicate/evaluate.js";
import type { SourceSpan } from "../diagnostics/span.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";

// Re-export the shared diagnostic types so existing importers of
// `../validate/validate.js` keep resolving them.
export { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";

/** Mirrors Model.memberKey — the per-instance member span key. */
function memberKey(node: NodeId, member: string): string {
  return `${node}#${member}`;
}

/** Prefer the instance's per-member span; fall back to the instance node span. */
function spanFor(model: Model, node: NodeId, member: string | null): SourceSpan | null {
  if (member !== null) {
    const memberSpan = model.spanOf(memberKey(node, member));
    if (memberSpan !== null) return memberSpan;
  }
  return model.spanOf(node);
}

export function validate(model: Model): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const node of model.allNodes()) {
    if (node.tier !== Tier.Instance) continue;
    const schema = model.effectiveSchema(node.typeOf);
    for (const field of schema.fields) {
      checkCardinality(diagnostics, model, node, field.name, field.cardinality, countField(model, node, field));
    }
    for (const relationship of schema.relationships) {
      const targets = model.related(node.id, EdgeKind.Relationship, Direction.Out, relationship.name);
      checkCardinality(diagnostics, model, node, relationship.name, relationship.cardinality, targets.length);
      checkTargetTypes(diagnostics, model, node, relationship, targets);
    }
    checkInvariants(diagnostics, model, node);
  }
  return diagnostics;
}

function checkTargetTypes(
  out: Diagnostic[],
  model: Model,
  node: Node,
  relationship: RelationshipSchema,
  targets: NodeId[],
): void {
  if (relationship.target === "") return;
  const allowed = new Set<NodeId>([relationship.target, ...model.subtypesOf(relationship.target)]);
  const path = `${node.typeOf}.${relationship.name}`;
  for (const target of targets) {
    const targetNode = model.resolve(target);
    if (targetNode !== undefined && !allowed.has(targetNode.typeOf)) {
      out.push({
        code: DiagnosticCode.TargetTypeMismatch,
        severity: Severity.Error,
        node: node.id,
        path,
        message: `"${path}" expects ${relationship.target} but "${target}" is a ${targetNode.typeOf}`,
        span: spanFor(model, node.id, relationship.name),
      });
    }
  }
}

function checkInvariants(out: Diagnostic[], model: Model, node: Node): void {
  for (const concept of [node.typeOf, ...model.supertypesOf(node.typeOf)]) {
    for (const invariant of model.invariantsFor(concept)) {
      if (!satisfies(model, invariant.expr, node.id)) {
        out.push({
          code: DiagnosticCode.InvariantFailed,
          severity: Severity.Error,
          node: node.id,
          path: concept,
          message: `invariant failed on "${node.id}": ${invariant.description}`,
          span: spanFor(model, node.id, null),
        });
      }
    }
  }
}

/**
 * Count a field's values without guessing scalar-vs-reference from the type
 * name. A field is stored exactly one way — a scalar attr (`label = "x"`,
 * `type = physical | …`) or relationship edges (`type = service`,
 * `implemented-by = &tech`) — so summing both is correct for every case and
 * avoids a fragile primitive-name heuristic (EA's `identifier` / `label` /
 * `slug` are not builtins).
 */
function countField(model: Model, node: Node, field: FieldSchema): number {
  const attrCount = node.attrs.has(field.name) ? 1 : 0;
  const edgeCount = model.related(node.id, EdgeKind.Relationship, Direction.Out, field.name).length;
  return attrCount + edgeCount;
}

function checkCardinality(
  out: Diagnostic[],
  model: Model,
  node: Node,
  member: string,
  cardinality: Cardinality,
  count: number,
): void {
  const path = `${node.typeOf}.${member}`;
  const span = spanFor(model, node.id, member);
  switch (cardinality) {
    case Cardinality.One:
      if (count === 0) {
        out.push(error(DiagnosticCode.RequiredMissing, node.id, path, `required "${path}" is missing on "${node.id}"`, span));
      } else if (count > 1) {
        out.push(error(DiagnosticCode.TooMany, node.id, path, `"${path}" allows one value but "${node.id}" has ${count}`, span));
      }
      break;
    case Cardinality.Optional:
      if (count > 1) {
        out.push(error(DiagnosticCode.TooMany, node.id, path, `"${path}" allows at most one value but "${node.id}" has ${count}`, span));
      }
      break;
    case Cardinality.NonEmpty:
      if (count === 0) {
        out.push(error(DiagnosticCode.EmptyNotAllowed, node.id, path, `"${path}" requires at least one value on "${node.id}"`, span));
      }
      break;
    case Cardinality.Many:
      break;
  }
}

function error(code: DiagnosticCode, node: NodeId, path: string, message: string, span: SourceSpan | null): Diagnostic {
  return { code, severity: Severity.Error, node, path, message, span };
}
