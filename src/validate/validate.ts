/**
 * Semantic validation (design spec §6) — machine-legible diagnostics an agent
 * can act on. Checks cardinality against each instance's *effective* (own +
 * inherited-from-class) concept schema, relationship target types, invariants,
 * class instantiation rules, and taxonomy integrity.
 *
 * A **class** (partial, fixed-value definition) is exempt from completeness
 * (required/non-empty) — its instances complete it — but still checked for
 * over-cardinality and target types. A **leaf** (an `instanceof` target's
 * instance) is counted over the merged class+leaf view.
 */

import { Tier, EdgeKind, Direction, Cardinality, type NodeId, type Node } from "../model/graph.js";
import { MetaKind } from "../model/kinds.js";
import { Repository, type FieldSchema, type RelationshipSchema } from "../model/model.js";
import { satisfies } from "../predicate/evaluate.js";
import type { SourceSpan } from "../diagnostics/span.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";

// Re-export the shared diagnostic types so existing importers keep resolving them.
export { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";

/** Mirrors Repository.memberKey — the per-instance member span key. */
function memberKey(node: NodeId, member: string): string {
  return `${node}#${member}`;
}

/** Prefer the instance's per-member span; fall back to the instance node span. */
function spanFor(model: Repository, node: NodeId, member: string | null): SourceSpan | null {
  if (member !== null) {
    const memberSpan = model.spanOf(memberKey(node, member));
    if (memberSpan !== null) return memberSpan;
  }
  return model.spanOf(node);
}

export function validate(model: Repository): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const node of model.allNodes()) {
    if (node.tier === Tier.Ontology && node.typeOf === MetaKind.Taxonomy) {
      checkRepresents(diagnostics, model, node);
      checkTermConcepts(diagnostics, model, node);
      continue;
    }
    if (node.tier === Tier.Instance && node.typeOf === MetaKind.Model) {
      validateModel(diagnostics, model, node);
      continue;
    }
    if (node.tier !== Tier.Instance) continue;
    validateInstance(diagnostics, model, node);
  }
  return diagnostics;
}

/** The model's bound vocabulary: its meta-model plus each used library. */
function boundModules(node: Node): { metaModel: string | undefined; uses: string[]; set: Set<string> } {
  const metaModel = typeof node.attrs.get("meta-model") === "string"
    ? (node.attrs.get("meta-model") as string) : undefined;
  const count = typeof node.attrs.get("uses.count") === "number"
    ? (node.attrs.get("uses.count") as number) : 0;
  const uses: string[] = [];
  for (let i = 0; i < count; i++) {
    const lib = node.attrs.get(`uses.${i}`);
    if (typeof lib === "string") uses.push(lib);
  }
  const set = new Set<string>([...(metaModel ? [metaModel] : []), ...uses]);
  return { metaModel, uses, set };
}

/** Validate a model node: bound modules resolve, and constructors stay in scope. */
function validateModel(out: Diagnostic[], model: Repository, node: Node): void {
  const { metaModel, uses } = boundModules(node);

  const present = new Set<string>();
  for (const n of model.allNodes()) {
    const ns = n.attrs.get("namespace");
    if (typeof ns === "string") present.add(ns);
  }

  const flagBinding = (name: string, member: string): void => {
    if (present.has(name)) return;
    out.push({
      code: DiagnosticCode.ModelBindingUndefined,
      severity: Severity.Error,
      message: `model "${node.id}" binds "${name}", but no loaded module provides it`,
      span: model.spanOf(Repository.memberKey(node.id, member)) ?? model.spanOf(node.id),
      node: node.id,
      path: null,
    });
  };
  if (metaModel !== undefined) flagBinding(metaModel, "meta-model");
  uses.forEach((lib, i) => flagBinding(lib, `uses.${i}`));
}

function validateInstance(out: Diagnostic[], model: Repository, node: Node): void {
  const partial = model.isClass(node.id);
  const cls = model.classOf(node.id);
  const effAttrs = cls !== null ? model.effectiveFields(node.id) : node.attrs;
  const effRels = cls !== null ? model.effectiveRelationships(node.id) : null;

  const targetsFor = (name: string): NodeId[] =>
    effRels !== null
      ? effRels.get(name) ?? []
      : model.related(node.id, EdgeKind.Relationship, Direction.Out, name);

  const schema = model.effectiveSchema(node.typeOf);
  for (const field of schema.fields) {
    const targets = targetsFor(field.name);
    const count = (effAttrs.has(field.name) ? 1 : 0) + targets.length;
    checkCardinality(out, model, node, field.name, field.cardinality, count, partial);
    checkTaxonomyValue(out, model, node, field, targets);
  }
  for (const relationship of schema.relationships) {
    const targets = targetsFor(relationship.name);
    checkCardinality(out, model, node, relationship.name, relationship.cardinality, targets.length, partial);
    checkTargetTypes(out, model, node, relationship, targets);
  }
  if (!partial) checkInvariants(out, model, node);
  if (cls !== null) {
    checkBinding(out, model, node, cls);
    checkOverride(out, model, node, cls);
  }
}

/** A taxonomy must name at least one concept it represents (else the ontology is incomplete). */
function checkRepresents(out: Diagnostic[], model: Repository, node: Node): void {
  if (model.represents(node.id).length === 0) {
    out.push(
      error(
        DiagnosticCode.TaxonomyNoRepresentedConcept,
        node.id,
        node.id,
        `taxonomy "${node.id}" represents no concept`,
        spanFor(model, node.id, null),
      ),
    );
  }
}

/** Every term of a taxonomy must be a class of one of the concepts it represents. */
function checkTermConcepts(out: Diagnostic[], model: Repository, node: Node): void {
  const represented = new Set(model.represents(node.id));
  if (represented.size === 0) return; // already reported by checkRepresents
  for (const termId of model.termsOf(node.id)) {
    const term = model.resolve(termId);
    if (term !== undefined && !represented.has(term.typeOf)) {
      out.push(
        error(
          DiagnosticCode.TermConceptNotRepresented,
          termId,
          node.id,
          `term "${termId}" is a ${term.typeOf} but taxonomy "${node.id}" represents ${[...represented].join(", ")}`,
          spanFor(model, termId, null),
        ),
      );
    }
  }
}

/** A value on a taxonomy-typed field must resolve to a term of that taxonomy. */
function checkTaxonomyValue(
  out: Diagnostic[],
  model: Repository,
  node: Node,
  field: FieldSchema,
  targets: NodeId[],
): void {
  const typeNode = model.resolve(field.type);
  if (typeNode === undefined || typeNode.typeOf !== MetaKind.Taxonomy) return;
  const terms = new Set(model.termsOf(field.type));
  const path = `${node.typeOf}.${field.name}`;
  for (const target of targets) {
    if (!terms.has(target)) {
      out.push(
        error(
          DiagnosticCode.TaxonomyValueUnresolved,
          node.id,
          path,
          `"${path}" expects a term of taxonomy ${field.type} but "${target}" is not one`,
          spanFor(model, node.id, field.name),
        ),
      );
    }
  }
}

/** `instanceof X` requires X to exist, be a class, and share the leaf's concept. */
function checkBinding(out: Diagnostic[], model: Repository, node: Node, cls: NodeId): void {
  const clsNode = model.resolve(cls);
  const path = `${node.typeOf}.instanceof`;
  const span = spanFor(model, node.id, null);
  if (clsNode === undefined) {
    out.push(error(DiagnosticCode.BindingInvalid, node.id, path, `"${node.id}" instantiates unknown class "${cls}"`, span));
    return;
  }
  if (clsNode.attrs.get("class") !== true) {
    out.push(error(DiagnosticCode.BindingInvalid, node.id, path, `"${node.id}" instantiates "${cls}" which is not a class`, span));
  } else if (clsNode.typeOf !== node.typeOf) {
    out.push(
      error(
        DiagnosticCode.BindingInvalid,
        node.id,
        path,
        `"${node.id}" (${node.typeOf}) cannot instantiate "${cls}" (${clsNode.typeOf})`,
        span,
      ),
    );
  }
}

/** A leaf may not set a class-fixed scalar field to a different value. */
function checkOverride(out: Diagnostic[], model: Repository, node: Node, cls: NodeId): void {
  const clsNode = model.resolve(cls);
  if (clsNode === undefined) return;
  for (const [name, value] of node.attrs) {
    if (name === "id" || name === "class") continue;
    const fixed = clsNode.attrs.get(name);
    if (fixed !== undefined && fixed !== value) {
      out.push(
        error(
          DiagnosticCode.ClassOverride,
          node.id,
          `${node.typeOf}.${name}`,
          `"${node.id}" overrides class-fixed "${name}" ("${String(fixed)}") with "${String(value)}"`,
          spanFor(model, node.id, name),
        ),
      );
    }
  }
}

function checkTargetTypes(
  out: Diagnostic[],
  model: Repository,
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

function checkInvariants(out: Diagnostic[], model: Repository, node: Node): void {
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

function checkCardinality(
  out: Diagnostic[],
  model: Repository,
  node: Node,
  member: string,
  cardinality: Cardinality,
  count: number,
  partial: boolean,
): void {
  const path = `${node.typeOf}.${member}`;
  const span = spanFor(model, node.id, member);
  switch (cardinality) {
    case Cardinality.One:
      if (count === 0) {
        if (!partial) out.push(error(DiagnosticCode.RequiredMissing, node.id, path, `required "${path}" is missing on "${node.id}"`, span));
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
      if (count === 0 && !partial) {
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
