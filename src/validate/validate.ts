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

export enum Severity {
  Error = "error",
  Warning = "warning",
}

export enum DiagnosticCode {
  RequiredMissing = "cardinality.required-missing",
  TooMany = "cardinality.too-many",
  EmptyNotAllowed = "cardinality.empty-not-allowed",
  TargetTypeMismatch = "relationship.target-type",
  InvariantFailed = "invariant.failed",
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  /** The offending node, or `null` for whole-model diagnostics. */
  node: NodeId | null;
  /** Concept-qualified member path, e.g. `component.label`. */
  path: string | null;
  message: string;
}

export function validate(model: Model): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const node of model.allNodes()) {
    if (node.tier !== Tier.Instance) continue;
    const schema = model.effectiveSchema(node.typeOf);
    for (const field of schema.fields) {
      checkCardinality(diagnostics, node, field.name, field.cardinality, countField(model, node, field));
    }
    for (const relationship of schema.relationships) {
      const targets = model.related(node.id, EdgeKind.Relationship, Direction.Out, relationship.name);
      checkCardinality(diagnostics, node, relationship.name, relationship.cardinality, targets.length);
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
        });
      }
    }
  }
}

function countField(model: Model, node: Node, field: FieldSchema): number {
  const isScalar = model.resolve(field.type)?.typeOf === "primitive";
  if (isScalar) {
    return node.attrs.has(field.name) ? 1 : 0;
  }
  return model.related(node.id, EdgeKind.Relationship, Direction.Out, field.name).length;
}

function checkCardinality(
  out: Diagnostic[],
  node: Node,
  member: string,
  cardinality: Cardinality,
  count: number,
): void {
  const path = `${node.typeOf}.${member}`;
  switch (cardinality) {
    case Cardinality.One:
      if (count === 0) {
        out.push(error(DiagnosticCode.RequiredMissing, node.id, path, `required "${path}" is missing on "${node.id}"`));
      } else if (count > 1) {
        out.push(error(DiagnosticCode.TooMany, node.id, path, `"${path}" allows one value but "${node.id}" has ${count}`));
      }
      break;
    case Cardinality.Optional:
      if (count > 1) {
        out.push(error(DiagnosticCode.TooMany, node.id, path, `"${path}" allows at most one value but "${node.id}" has ${count}`));
      }
      break;
    case Cardinality.NonEmpty:
      if (count === 0) {
        out.push(error(DiagnosticCode.EmptyNotAllowed, node.id, path, `"${path}" requires at least one value on "${node.id}"`));
      }
      break;
    case Cardinality.Many:
      break;
  }
}

function error(code: DiagnosticCode, node: NodeId, path: string, message: string): Diagnostic {
  return { code, severity: Severity.Error, node, path, message };
}
