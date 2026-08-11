/**
 * The single reference walk (design: unified-reference-resolver). One traversal
 * of the AST that yields EVERY symbol reference — with its role, span, and a
 * rewrite hook that mutates the underlying AST field. The loader consumes it to
 * build resolution sites (and rewrite qualified `ns.x` to flat ids); the
 * language-service reference-index consumes it for find-references / hover /
 * go-to-definition. Having one walk means the two can never drift on "what is a
 * reference." `collectDefinitions` is the companion walk for the definitions a
 * declaration introduces (its own node ids).
 *
 * `uses` targets are handled by the loader's own uses-normalization pass (they
 * must be flattened before term-body scope resolution), and namespace `import`
 * paths are not symbol references — neither is emitted here.
 */
import {
  DeclKind, ValueKind,
  type Declaration, type InstanceDecl, type Term, type ValueNode, type AnnotationApplication,
} from "./ast.js";
import type { SourceSpan } from "../diagnostics/span.js";
import { PACKAGE_NODE_ID } from "../model/kinds.js";

export enum RefRole {
  Extends,
  FieldType,
  RelationshipTarget,
  Represents,
  Frames,
  RecordConcept,
  InstanceOf,
  RefValue,
  AnnotationName,
  ParamType,
}

export interface ReferenceVisit {
  /** The reference as written — bare or qualified (`ns.x`). */
  name: string;
  span: SourceSpan | undefined;
  role: RefRole;
  /** The declaring node id (for diagnostics), or null. */
  ownerNode: string | null;
  /** The member name this reference sits on (field / assignment), or null. */
  memberPath: string | null;
  /** Rewrite the underlying AST field to a flat id (qualified → flat, or bare
   * term → taxonomy-qualified sibling). */
  rewrite: (flat: string) => void;
  /** Set for a reference inside a taxonomy term body: the enclosing taxonomy +
   * its `uses` list, for sibling / cross-taxonomy bare resolution. */
  scope?: { taxonomy: string; uses: readonly string[] };
}

/** Transparent file-wrapper "concepts" that are not real concept references. */
const WRAPPER_CONCEPTS: ReadonlySet<string> = new Set(["technology-library"]);

export type Visit = (v: ReferenceVisit) => void;

/** Yield every symbol reference in `decl`. */
export function visitReferences(decl: Declaration, visit: Visit): void {
  const annotationRefs = (apps: readonly AnnotationApplication[], node: string): void => {
    for (const app of apps) {
      visit({ name: app.name, span: app.nameSpan ?? app.span, role: RefRole.AnnotationName,
        ownerNode: `${node}@${app.name}`, memberPath: null, rewrite: (r) => { app.name = r; } });
    }
  };
  switch (decl.kind) {
    case DeclKind.Taxonomy: {
      decl.represents.forEach((c, i) => visit({
        name: c, span: decl.representsSpans?.[i] ?? decl.span, role: RefRole.Represents,
        ownerNode: decl.name, memberPath: null, rewrite: (r) => { decl.represents[i] = r; },
      }));
      annotationRefs(decl.annotations, decl.name);
      const scope = { taxonomy: decl.name, uses: decl.uses };
      const walkTerm = (t: Term): void => {
        for (const a of t.assignments) visitValueRefs(a.value, `${decl.name}.${t.id}`, a.name, a.span, scope, visit);
        t.children.forEach(walkTerm);
      };
      decl.terms.forEach(walkTerm);
      break;
    }
    case DeclKind.Viewpoint: {
      decl.frames.forEach((c, i) => visit({
        name: c, span: decl.framesSpans?.[i] ?? decl.span, role: RefRole.Frames,
        ownerNode: decl.name, memberPath: null, rewrite: (r) => { decl.frames[i] = r; },
      }));
      break;
    }
    case DeclKind.Concept: {
      if (decl.extends !== null) {
        visit({ name: decl.extends, span: decl.extendsSpan ?? decl.span, role: RefRole.Extends,
          ownerNode: decl.name, memberPath: null, rewrite: (r) => { (decl as { extends: string | null }).extends = r; } });
      }
      for (const f of decl.fields) {
        visit({ name: f.type, span: f.typeSpan ?? decl.span, role: RefRole.FieldType,
          ownerNode: decl.name, memberPath: f.name, rewrite: (r) => { f.type = r; } });
      }
      for (const rel of decl.relationships) {
        rel.targets.forEach((target, i) => visit({
          name: target, span: rel.targetSpans?.[i] ?? decl.span, role: RefRole.RelationshipTarget,
          ownerNode: decl.name, memberPath: rel.name, rewrite: (r) => { rel.targets[i] = r; },
        }));
      }
      annotationRefs(decl.annotations, decl.name);
      break;
    }
    case DeclKind.Annotation:
      for (const p of decl.params) {
        visit({ name: p.type, span: p.typeSpan ?? decl.span, role: RefRole.ParamType,
          ownerNode: decl.name, memberPath: p.name, rewrite: (r) => { p.type = r; } });
      }
      break;
    case DeclKind.Instance:
      visitInstanceRefs(decl, visit);
      break;
    case DeclKind.Model: {
      // A model's `uses` list is a term-drop scope for its instance value refs
      // (the model analogue of a taxonomy body's `uses`): a bare `azure-openai`
      // drops to the flat `stack.azure-openai` term. There is no enclosing
      // taxonomy, so the sibling slot is empty. `decl.libraries` is the same
      // array the loader normalizes qualified→flat in place before resolution.
      const scope = { taxonomy: "", uses: decl.libraries };
      for (const inst of decl.instances) visitInstanceRefs(inst, visit, scope);
      break;
    }
    case DeclKind.Package:
      annotationRefs(decl.annotations, PACKAGE_NODE_ID);
      break;
    case DeclKind.Primitive:
      break;
  }
}

function visitInstanceRefs(
  decl: InstanceDecl,
  visit: Visit,
  scope?: { taxonomy: string; uses: readonly string[] },
): void {
  // Concept and `instanceof` are constructor references — resolved by namespace
  // reachability, never term-dropped — so they carry no scope. Only value
  // assignments (and nested records) inherit the model's term-drop scope.
  if (!WRAPPER_CONCEPTS.has(decl.concept)) {
    visit({ name: decl.concept, span: decl.conceptSpan ?? decl.span, role: RefRole.RecordConcept,
      ownerNode: decl.id, memberPath: null, rewrite: (r) => { (decl as { concept: string }).concept = r; } });
  }
  if (decl.instanceOf !== null) {
    visit({ name: decl.instanceOf, span: decl.instanceOfSpan ?? decl.span, role: RefRole.InstanceOf,
      ownerNode: decl.id, memberPath: null, rewrite: (r) => { (decl as { instanceOf: string | null }).instanceOf = r; } });
  }
  for (const a of decl.assignments) visitValueRefs(a.value, decl.id, a.name, a.span, scope, visit);
  for (const child of decl.children) visitInstanceRefs(child, visit, scope);
}

function visitValueRefs(
  value: ValueNode,
  ownerNode: string,
  memberName: string,
  memberSpan: SourceSpan | undefined,
  scope: { taxonomy: string; uses: readonly string[] } | undefined,
  visit: Visit,
): void {
  switch (value.kind) {
    case ValueKind.Name:
      visit({ name: value.name, span: value.span ?? memberSpan, role: RefRole.RefValue,
        ownerNode, memberPath: memberName, rewrite: (r) => { (value as { name: string }).name = r; },
        ...(scope ? { scope } : {}) });
      break;
    case ValueKind.List:
      for (const item of value.items) visitValueRefs(item, ownerNode, memberName, memberSpan, scope, visit);
      break;
    case ValueKind.String:
    case ValueKind.Composite:
    case ValueKind.Boolean:
      break;
  }
}

/** Record every node id a declaration DEFINES (its own name + nested term /
 * child ids), stamping each with its home namespace. Companion to
 * {@link visitReferences}. */
export function collectDefinitions(
  decl: Declaration,
  ns: string,
  defined: Set<string>,
  sourceNs: Map<string, string>,
): void {
  const define = (id: string): void => { defined.add(id); sourceNs.set(id, ns); };
  switch (decl.kind) {
    case DeclKind.Primitive:
    case DeclKind.Concept:
    case DeclKind.Annotation:
      define(decl.name);
      break;
    case DeclKind.Taxonomy: {
      define(decl.name);
      const add = (t: Term): void => { define(`${decl.name}.${t.id}`); t.children.forEach(add); };
      decl.terms.forEach(add);
      break;
    }
    case DeclKind.Viewpoint:
      define(decl.name);
      break;
    case DeclKind.Instance:
      defineInstance(decl, ns, defined, sourceNs);
      break;
    case DeclKind.Model:
      define(decl.id);
      for (const inst of decl.instances) defineInstance(inst, ns, defined, sourceNs);
      break;
    case DeclKind.Package:
      break;
  }
}

function defineInstance(decl: InstanceDecl, ns: string, defined: Set<string>, sourceNs: Map<string, string>): void {
  defined.add(decl.id);
  sourceNs.set(decl.id, ns);
  for (const child of decl.children) defineInstance(child, ns, defined, sourceNs);
}
