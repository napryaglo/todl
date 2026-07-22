/**
 * Loader (design spec §5) — parse TODL sources and build a {@link Repository}.
 *
 * Two passes over the combined declarations: pass one defines the bare type
 * declarations (primitives, enums + case nodes, concepts + extends) and creates
 * placeholder nodes for any *referenced-but-undefined* id (the fixtures
 * deliberately reference `lane` / `event-trigger` / … without defining them);
 * pass two adds concept members and instances. Executable invariants register
 * after loading. Field types / relationship targets are attrs, so they need no
 * node — only extends parents and instance value refs become edges.
 */

import { parse } from "./parser.js";
import { parsePredicate } from "./predicate-parser.js";
import { Repository } from "../model/model.js";
import type { Builder, TermInput } from "../model/builder.js";
import type { Expr } from "../predicate/ast.js";
import {
  DeclKind,
  ValueKind,
  type Declaration,
  type InstanceDecl,
  type Term,
  type ValueNode,
  type AssignmentNode,
} from "./ast.js";
import type { Scalar } from "../model/graph.js";
import type { SourceFile } from "../diagnostics/span.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";

export interface LoadResult {
  model: Repository;
  diagnostics: Diagnostic[];
}

const UNRESOLVED = "unresolved";

interface PendingInvariant {
  concept: string;
  expr: Expr;
  description: string;
}

export function load(sources: SourceFile[]): LoadResult {
  const model = new Repository();
  const diagnostics = loadInto(model, sources);
  return { model, diagnostics };
}

// Load `sources` INTO an existing model (which may already carry base nodes from
// a prior compile — see checkAgainst). Same 3-pass pipeline as a fresh load, and
// a reference that resolves to a node already in `model` is not stubbed
// UNRESOLVED. Returns the accumulated diagnostics; the caller owns the model.
export function loadInto(model: Repository, sources: SourceFile[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const declarations = sources.flatMap((source) => {
    const result = parse(source.text, source.uri);
    diagnostics.push(...result.diagnostics);
    return result.namespace.declarations;
  });

  const defined = new Set<string>();
  const referenced = new Set<string>();
  for (const declaration of declarations) collectNames(declaration, defined, referenced);

  // Composition records nested in a taxonomy term (a `billing` record inside a
  // `technology` term) — deferred to pass 2b so they can bind to the term's
  // field once concept schemas are committed.
  const deferredCompositions: { parentId: string; parentConcept: string; decl: InstanceDecl }[] = [];

  // Pass 1: bare type declarations + placeholders for unresolved references.
  const first = model.builder();
  for (const declaration of declarations) {
    switch (declaration.kind) {
      case DeclKind.Primitive:
        first.definePrimitive(declaration.name);
        break;
      case DeclKind.Taxonomy: {
        const decl = declaration;
        const represented = new Set(decl.represents);
        const multi = decl.represents.length > 1;
        const primary = decl.represents[0] ?? "";

        // Build a term, partitioning its nested blocks: a same-concept child is
        // a sub-term (hierarchy); a different but represented concept is a
        // composition record bound to the term's field (deferred); a
        // non-represented concept is an error ("throw and require a concept").
        const buildTerm = (t: Term, ownConcept: string): TermInput => {
          if (t.concept === null && multi) {
            diagnostics.push({
              code: DiagnosticCode.TaxonomyTermConceptAmbiguous,
              severity: Severity.Error,
              message: `term "${t.id}" in taxonomy "${decl.name}" must name its concept (one of ${decl.represents.join(", ")})`,
              span: t.span,
              node: `${decl.name}.${t.id}`,
              path: decl.name,
            });
          }
          const hierarchy: TermInput[] = [];
          for (const child of t.children) {
            const childConcept = child.concept;
            if (childConcept === null || childConcept === ownConcept) {
              hierarchy.push(buildTerm(child, childConcept ?? ownConcept));
            } else if (represented.has(childConcept)) {
              deferredCompositions.push({
                parentId: `${decl.name}.${t.id}`,
                parentConcept: ownConcept,
                decl: termToInstanceDecl(decl.name, child),
              });
            } else {
              diagnostics.push({
                code: DiagnosticCode.TermConceptNotRepresented,
                severity: Severity.Error,
                message: `nested "${childConcept}" record "${child.id}" in term "${decl.name}.${t.id}" — "${childConcept}" is not a represented concept of taxonomy "${decl.name}"`,
                span: child.span,
                node: `${decl.name}.${child.id}`,
                path: decl.name,
              });
            }
          }
          return {
            id: t.id,
            ...(t.concept !== null ? { concept: t.concept } : {}),
            attrs: termAttrs(t.assignments),
            relationships: termRelationships(t.assignments),
            children: hierarchy,
          };
        };

        first.defineTaxonomy(decl.name, decl.represents, decl.terms.map((t) => buildTerm(t, t.concept ?? primary)));
        break;
      }
      case DeclKind.Concept:
        first.defineConcept(declaration.name, declaration.extends);
        break;
      case DeclKind.Instance:
        break;
    }
  }
  for (const id of referenced) {
    // A reference already present in the model (a base node under checkAgainst)
    // resolves to it — don't stub it as UNRESOLVED. Empty graph under plain
    // load(), so this is a no-op there.
    if (!defined.has(id) && !model.has(id)) first.assertInstance(UNRESOLVED, id);
  }
  first.commit();

  // Pass 2a: concept members (fields / relationships / invariants). Committing
  // these before instances lets a nested record consult the parent's schema.
  const second = model.builder();
  const invariants: PendingInvariant[] = [];
  for (const declaration of declarations) {
    if (declaration.kind !== DeclKind.Concept) continue;
    for (const field of declaration.fields) {
      second.addField(declaration.name, field.name, field.type, field.cardinality);
    }
    for (const relationship of declaration.relationships) {
      second.addConceptRelationship(declaration.name, relationship.name, relationship.target, relationship.cardinality);
    }
    for (const invariant of declaration.invariants) {
      if (invariant.predicate !== null) {
        invariants.push({
          concept: declaration.name,
          expr: parsePredicate(invariant.predicate),
          description: invariant.description,
        });
      }
    }
  }
  second.commit();

  // Pass 2b: instances. The schema is committed, so a nested record binds to the
  // parent field typed by its concept (in addition to the structural Contains).
  const third = model.builder();
  const asserted = new Set<string>();
  for (const declaration of declarations) {
    if (declaration.kind === DeclKind.Instance) {
      applyInstance(third, model, declaration, null, null, asserted, diagnostics);
    }
  }
  // Composition records nested in taxonomy terms — applied here so they bind to
  // the parent term's field against the now-committed concept schema.
  for (const composition of deferredCompositions) {
    applyInstance(third, model, composition.decl, composition.parentId, composition.parentConcept, asserted, diagnostics);
  }
  third.commit();

  for (const invariant of invariants) {
    model.defineInvariant(invariant.concept, invariant.expr, invariant.description);
  }

  recordSpans(model, declarations);
  return diagnostics;
}

/** Record each declaration's, instance's, and assignment's source span on the model. */
function recordSpans(model: Repository, declarations: Declaration[]): void {
  for (const declaration of declarations) {
    switch (declaration.kind) {
      case DeclKind.Primitive:
      case DeclKind.Concept:
        model.recordSpan(declaration.name, declaration.span);
        break;
      case DeclKind.Taxonomy: {
        model.recordSpan(declaration.name, declaration.span);
        const record = (t: Term): void => {
          model.recordSpan(`${declaration.name}.${t.id}`, t.span);
          t.children.forEach(record);
        };
        declaration.terms.forEach(record);
        break;
      }
      case DeclKind.Instance:
        recordInstanceSpans(model, declaration);
        break;
    }
  }
}

function recordInstanceSpans(model: Repository, decl: InstanceDecl): void {
  model.recordSpan(decl.id, decl.span);
  for (const assignment of decl.assignments) {
    if (assignment.span !== undefined) {
      model.recordSpan(Repository.memberKey(decl.id, assignment.name), assignment.span);
    }
  }
  for (const child of decl.children) recordInstanceSpans(model, child);
}

function collectNames(declaration: Declaration, defined: Set<string>, referenced: Set<string>): void {
  switch (declaration.kind) {
    case DeclKind.Primitive:
      defined.add(declaration.name);
      break;
    case DeclKind.Taxonomy: {
      defined.add(declaration.name);
      for (const concept of declaration.represents) referenced.add(concept);
      // Term nodes are taxonomy-qualified (see Builder.defineTaxonomy); record
      // every term's qualified id (nested included) so bare term values resolve,
      // and collect the refs their fixed relationships/compositions point at.
      const add = (t: Term): void => {
        defined.add(`${declaration.name}.${t.id}`);
        for (const assignment of t.assignments) collectValueRefs(assignment.value, referenced);
        t.children.forEach(add);
      };
      declaration.terms.forEach(add);
      break;
    }
    case DeclKind.Concept:
      defined.add(declaration.name);
      if (declaration.extends !== null) referenced.add(declaration.extends);
      break;
    case DeclKind.Instance:
      collectInstanceNames(declaration, defined, referenced);
      break;
  }
}

function collectInstanceNames(decl: InstanceDecl, defined: Set<string>, referenced: Set<string>): void {
  defined.add(decl.id);
  if (decl.instanceOf !== null) referenced.add(decl.instanceOf);
  for (const assignment of decl.assignments) collectValueRefs(assignment.value, referenced);
  for (const child of decl.children) collectInstanceNames(child, defined, referenced);
}

/** A term's scalar fixed-value fields (String/Name/Composite) as an attr map.
 * `Ref`/`List` assignments are domain relationships — see {@link termRelationships}. */
function termAttrs(assignments: AssignmentNode[]): Map<string, Scalar> {
  const attrs = new Map<string, Scalar>();
  for (const assignment of assignments) {
    const value = assignment.value;
    if (value.kind === ValueKind.String) attrs.set(assignment.name, value.text);
    else if (value.kind === ValueKind.Name) attrs.set(assignment.name, value.name);
    else if (value.kind === ValueKind.Composite) attrs.set(assignment.name, value.parts.join(" | "));
  }
  return attrs;
}

/** A term's relationship-valued fixed fields (`&ref` and `[…]` lists), as
 * (name -> target) pairs. `List` items may be bare names or `&`-refs. */
function termRelationships(assignments: AssignmentNode[]): { name: string; target: string }[] {
  const rels: { name: string; target: string }[] = [];
  for (const assignment of assignments) {
    const value = assignment.value;
    if (value.kind === ValueKind.Ref) {
      rels.push({ name: assignment.name, target: value.ref });
    } else if (value.kind === ValueKind.List) {
      for (const item of value.items) {
        if (item.kind === ValueKind.Name) rels.push({ name: assignment.name, target: item.name });
        else if (item.kind === ValueKind.Ref) rels.push({ name: assignment.name, target: item.ref });
      }
    }
  }
  return rels;
}

/** Convert a composition term (a nested record of a *different* represented
 * concept, e.g. a `billing` inside a `technology` term) into an instance
 * declaration — a class-level record applied through the instance machinery so
 * it binds to the parent term's field. Its own children are nested records. */
function termToInstanceDecl(taxonomy: string, t: Term): InstanceDecl {
  return {
    kind: DeclKind.Instance,
    concept: t.concept ?? "",
    id: `${taxonomy}.${t.id}`,
    binds: null,
    isClass: true,
    instanceOf: null,
    assignments: t.assignments,
    children: t.children.map((c) => termToInstanceDecl(taxonomy, c)),
    span: t.span,
  };
}

function collectValueRefs(value: ValueNode, referenced: Set<string>): void {
  switch (value.kind) {
    case ValueKind.Ref:
      referenced.add(value.ref);
      break;
    case ValueKind.Name:
      referenced.add(value.name);
      break;
    case ValueKind.List:
      for (const item of value.items) collectValueRefs(item, referenced);
      break;
    case ValueKind.String:
    case ValueKind.Composite:
      break;
  }
}

/** File-level grouping keywords that wrap records but are not themselves records. */
const WRAPPER_CONCEPTS = new Set(["technology-library"]);

function applyInstance(
  builder: Builder,
  model: Repository,
  decl: InstanceDecl,
  parent: string | null,
  parentConcept: string | null,
  asserted: Set<string>,
  diagnostics: Diagnostic[],
): void {
  // A `technology-library` is a transparent file wrapper (not an EA concept);
  // its members are top-level records. Skipping the container node also avoids
  // a legacy id collision (the aws library names both its container and its
  // root location `aws`).
  if (WRAPPER_CONCEPTS.has(decl.concept)) {
    for (const child of decl.children) applyInstance(builder, model, child, null, null, asserted, diagnostics);
    return;
  }

  // Legacy authoring may declare the same record id in more than one place
  // (e.g. a component under two location blocks); merge later fields onto the
  // first assertion rather than erroring on the duplicate node.
  const first = !asserted.has(decl.id);
  if (first) {
    asserted.add(decl.id);
    builder.assertInstance(decl.concept, decl.id, decl.isClass);
    // The record name is its `id`; surface it as the field the schema declares.
    builder.setField(decl.id, "id", decl.id);
    if (decl.binds !== null) builder.setField(decl.id, "meta-model", decl.binds);
    if (decl.instanceOf !== null) builder.addInstanceOf(decl.id, decl.instanceOf);
    if (parent !== null) {
      builder.addContains(parent, decl.id);
      if (parentConcept !== null) bindToField(builder, model, parent, parentConcept, decl, diagnostics);
    }
  }
  for (const assignment of decl.assignments) {
    applyValue(builder, decl.id, assignment.name, assignment.value);
  }
  for (const child of decl.children) {
    applyInstance(builder, model, child, decl.id, decl.concept, asserted, diagnostics);
  }
}

/**
 * Bind a nested record to the parent field whose declared type is the record's
 * concept, adding a field-named relationship alongside the structural Contains.
 * With no matching field the record is containment-only; with more than one, the
 * binding is ambiguous — diagnose and leave it containment-only.
 */
function bindToField(
  builder: Builder,
  model: Repository,
  parent: string,
  parentConcept: string,
  decl: InstanceDecl,
  diagnostics: Diagnostic[],
): void {
  const fields = model.effectiveSchema(parentConcept).fields.filter((field) => field.type === decl.concept);
  const [only] = fields;
  if (only === undefined) return;
  if (fields.length > 1) {
    diagnostics.push({
      code: DiagnosticCode.AmbiguousFieldBinding,
      severity: Severity.Error,
      message: `nested "${decl.concept}" record "${decl.id}" in "${parent}" matches multiple ${parentConcept} fields (${fields
        .map((field) => field.name)
        .join(", ")}); left as containment only`,
      span: decl.span,
      node: decl.id,
      path: parentConcept,
    });
    return;
  }
  builder.addRelationship(parent, only.name, decl.id);
}

function applyValue(builder: Builder, id: string, name: string, value: ValueNode): void {
  switch (value.kind) {
    case ValueKind.String:
      builder.setField(id, name, value.text);
      break;
    case ValueKind.Name:
      builder.addRelationship(id, name, value.name);
      break;
    case ValueKind.Ref:
      builder.addRelationship(id, name, value.ref);
      break;
    case ValueKind.List:
      for (const item of value.items) applyValue(builder, id, name, item);
      break;
    case ValueKind.Composite:
      // `|`-composed enum flags are stored as the legacy scalar string
      // (`"cloud | paas"`); the runtime enum table's has() splits on `|`.
      builder.setField(id, name, value.parts.join(" | "));
      break;
  }
}
