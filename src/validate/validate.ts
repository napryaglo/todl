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

import { Tier, EdgeKind, Direction, Cardinality, type NodeId, type Node, type Scalar } from "../model/graph.js";
import { MetaKind } from "../model/kinds.js";
import { Repository, type FieldSchema, type RelationshipSchema } from "../model/model.js";
import { namespaceOf } from "../resolve/resolver.js";
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
    if (node.tier === Tier.Ontology && node.typeOf === MetaKind.Viewpoint) {
      checkFrames(diagnostics, model, node);
      continue;
    }
    if (node.tier === Tier.Instance && node.typeOf === MetaKind.Model) {
      validateModel(diagnostics, model, node);
      continue;
    }
    if (node.tier === Tier.Ontology) {
      if (node.typeOf === MetaKind.Annotation) {
        validateAnnotationDecl(diagnostics, model, node);
        continue;
      }
      const def = model.resolve(node.typeOf);
      if (def !== undefined && def.typeOf === MetaKind.Annotation) {
        validateAnnotationApplication(diagnostics, model, node);
      }
      continue;
    }
    if (node.tier !== Tier.Instance) continue;
    validateInstance(diagnostics, model, node);
  }
  return diagnostics;
}

/** A model's declared bindings: its meta-model namespace (`: <metaModel>`) and
 * its `uses` taxonomies (each a flat taxonomy node id). */
function boundModules(node: Node): { metaModel: string | undefined; uses: string[] } {
  const metaModel = typeof node.attrs.get("MetaModel") === "string"
    ? (node.attrs.get("MetaModel") as string) : undefined;
  const count = typeof node.attrs.get("uses.count") === "number"
    ? (node.attrs.get("uses.count") as number) : 0;
  const uses: string[] = [];
  for (let i = 0; i < count; i++) {
    const tax = node.attrs.get(`uses.${i}`);
    if (typeof tax === "string") uses.push(tax);
  }
  return { metaModel, uses };
}

/** Validate a model node: its meta-model resolves, and every constructor stays
 * within the model's bound vocabulary. The bound namespaces are the meta-model
 * plus the namespace each used taxonomy lives in (a `uses stack` where `stack`
 * is in namespace `ea` binds `ea`). `uses` targets themselves are validated as
 * taxonomies by the loader. */
function validateModel(out: Diagnostic[], model: Repository, node: Node): void {
  const { metaModel, uses } = boundModules(node);

  const present = new Set<string>();
  for (const n of model.allNodes()) {
    const ns = n.attrs.get("namespace");
    if (typeof ns === "string") present.add(ns);
  }

  if (metaModel !== undefined && !present.has(metaModel)) {
    out.push({
      code: DiagnosticCode.ModelBindingUndefined,
      severity: Severity.Error,
      message: `model "${node.id}" binds "${metaModel}", but no loaded module provides it`,
      span: model.spanOf(Repository.memberKey(node.id, "meta-model")) ?? model.spanOf(node.id),
      node: node.id,
      path: null,
    });
  }

  // Bound vocabulary = the model's own namespace (local `class`/`concept`
  // constructors) + the meta-model namespace + the namespace of each used
  // taxonomy. Constructors (concepts, classes/terms) must come from one of these.
  const bound = new Set<string>(metaModel !== undefined ? [metaModel] : []);
  const ownNs = namespaceOf(model, node.id);
  if (ownNs !== null) bound.add(ownNs);
  for (const tax of uses) {
    const ns = namespaceOf(model, tax);
    if (ns !== null) bound.add(ns);
  }
  for (const objId of model.closure(node.id, EdgeKind.Contains, Direction.Out, false)) {
    const obj = model.resolve(objId);
    if (obj === undefined) continue;
    checkConstructor(out, model, obj, obj.typeOf, bound);    // the concept
    const cls = model.classOf(objId);
    if (cls !== null) checkConstructor(out, model, obj, cls, bound); // the instanceof class/term
  }

  // conforms <viewpoint>: an entity homed by a `conforms V` block carries its
  // home viewpoint as a per-entity `conforms` attr (a model split across files
  // homes different entities under different viewpoints). Each such entity's
  // concept must be framed by its viewpoint (subtype-aware via viewpointsFraming).
  for (const objId of model.closure(node.id, EdgeKind.Contains, Direction.Out, false)) {
    const obj = model.resolve(objId);
    if (obj === undefined || obj.attrs.get("class") === true) continue;
    const vp = obj.attrs.get("conforms");
    if (typeof vp !== "string" || model.resolve(vp)?.typeOf !== MetaKind.Viewpoint) continue;
    if (!model.viewpointsFraming(obj.typeOf).includes(vp)) {
      out.push({
        code: DiagnosticCode.ModelEntityNotFramed,
        severity: Severity.Error,
        message: `entity "${objId}" is a ${obj.typeOf}, not framed by viewpoint "${vp}"`,
        span: model.spanOf(objId) ?? model.spanOf(node.id),
        node: objId,
        path: null,
      });
    }
  }
}

/** A constructor (concept or class/term) is in scope iff its provider namespace is bound. */
function checkConstructor(
  out: Diagnostic[],
  model: Repository,
  obj: Node,
  ctorId: NodeId,
  bound: Set<string>,
): void {
  if (model.resolve(ctorId) === undefined) return;
  const ns = namespaceOf(model, ctorId);
  if (ns === null) return; // graceful degradation: unlabeled (old) base node
  if (bound.has(ns)) return;
  out.push({
    code: DiagnosticCode.ConstructorOutOfScope,
    severity: Severity.Error,
    message: `"${obj.id}" is built from "${ctorId}" (module "${ns}"), which is not in the model's bound vocabulary`,
    span: model.spanOf(obj.id),
    node: obj.id,
    path: null,
  });
}

/** Validate an annotation DECLARATION: its base must be an annotation, and it
 * may not redeclare an inherited param name (annotations disallow override,
 * unlike concept fields). */
function validateAnnotationDecl(out: Diagnostic[], model: Repository, node: Node): void {
  for (const baseId of model.related(node.id, EdgeKind.Extends, Direction.Out)) {
    const base = model.resolve(baseId);
    if (base !== undefined && base.typeOf !== MetaKind.Annotation) {
      out.push({
        code: DiagnosticCode.AnnotationBaseNotAnnotation,
        severity: Severity.Error,
        message: `annotation "${node.id}" may only extend an annotation, not "${baseId}"`,
        span: model.spanOf(node.id),
        node: node.id,
        path: null,
      });
    }
  }
  const inherited = new Set(
    model.supertypesOf(node.id).flatMap((s) => model.schemaOf(s).fields.map((f) => f.name)),
  );
  for (const f of model.schemaOf(node.id).fields) {
    if (inherited.has(f.name)) {
      out.push({
        code: DiagnosticCode.AnnotationParamRedeclared,
        severity: Severity.Error,
        message: `annotation "${node.id}" redeclares inherited parameter "${f.name}"`,
        span: model.spanOf(node.id),
        node: node.id,
        path: null,
      });
    }
  }
}

/** Validate an annotation application against its annotation's declared params. */
function validateAnnotationApplication(out: Diagnostic[], model: Repository, node: Node): void {
  const schema = model.effectiveSchema(node.typeOf);
  const declared = new Set(schema.fields.map((f) => f.name));

  for (const key of node.attrs.keys()) {
    if (key === "namespace") continue; // provenance, not a param
    if (!declared.has(key)) {
      out.push({
        code: DiagnosticCode.AnnotationUnknownParam,
        severity: Severity.Error,
        message: `annotation "${node.typeOf}" has no parameter "${key}"`,
        span: model.spanOf(node.id),
        node: node.id,
        path: null,
      });
    }
  }

  for (const f of schema.fields) {
    const required = f.cardinality === Cardinality.One || f.cardinality === Cardinality.NonEmpty;
    if (required && !node.attrs.has(f.name)) {
      out.push({
        code: DiagnosticCode.RequiredMissing,
        severity: Severity.Error,
        message: `annotation "${node.typeOf}" requires parameter "${f.name}"`,
        span: model.spanOf(node.id),
        node: node.id,
        path: null,
      });
    }
    checkBooleanValue(out, model, node, f, node.attrs);
  }
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
    checkBooleanValue(out, model, node, field, effAttrs);
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

/** A viewpoint must frame at least one concept, and every framed target must be
 *  a concept (not a taxonomy/primitive/etc.). */
function checkFrames(out: Diagnostic[], model: Repository, node: Node): void {
  const framed = model.frames(node.id);
  if (framed.length === 0) {
    out.push(
      error(
        DiagnosticCode.ViewpointNoFramedConcept,
        node.id,
        node.id,
        `viewpoint "${node.id}" frames no concept`,
        spanFor(model, node.id, null),
      ),
    );
    return;
  }
  for (const framedId of framed) {
    const target = model.resolve(framedId);
    if (target === undefined || target.typeOf !== MetaKind.Concept) {
      out.push(
        error(
          DiagnosticCode.ViewpointFramesNotConcept,
          node.id,
          node.id,
          `viewpoint "${node.id}" frames "${framedId}", which is not a concept`,
          spanFor(model, node.id, null),
        ),
      );
    }
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

/** A `boolean`-typed field/param must carry a boolean value (`true`/`false`),
 * not a string, number, or bare name. Absence is a cardinality concern. */
function checkBooleanValue(
  out: Diagnostic[],
  model: Repository,
  node: Node,
  field: FieldSchema,
  attrs: ReadonlyMap<string, Scalar>,
): void {
  if (field.type !== "boolean") return;
  const v = attrs.get(field.name);
  if (v === undefined || typeof v === "boolean") return;
  const path = `${node.typeOf}.${field.name}`;
  out.push(
    error(
      DiagnosticCode.BooleanValueInvalid,
      node.id,
      path,
      `"${path}" expects a boolean (true or false) but got "${String(v)}"`,
      spanFor(model, node.id, field.name),
    ),
  );
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
  if (relationship.targets.length === 0) return;
  const allowed = new Set<NodeId>();
  for (const t of relationship.targets) {
    allowed.add(t);
    for (const sub of model.subtypesOf(t)) allowed.add(sub);
  }
  const path = `${node.typeOf}.${relationship.name}`;
  const expected = relationship.targets.join(" | ");
  for (const target of targets) {
    const targetNode = model.resolve(target);
    if (targetNode !== undefined && !allowed.has(targetNode.typeOf)) {
      out.push({
        code: DiagnosticCode.TargetTypeMismatch,
        severity: Severity.Error,
        node: node.id,
        path,
        message: `"${path}" expects ${expected} but "${target}" is a ${targetNode.typeOf}`,
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
