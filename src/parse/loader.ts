/**
 * Loader (design spec §5) — parse TODL sources and build a {@link Repository}.
 *
 * Two passes over the combined declarations: pass one defines the bare type
 * declarations (primitives, enums + case nodes, concepts + extends); pass two
 * adds concept members and instances. Executable invariants register after
 * loading. Field types / relationship targets are attrs, so they need no node —
 * only extends parents and instance value refs become edges.
 *
 * Any id that is referenced but never defined (in the sources or in a previously
 * loaded base model) emits a `reference.undefined` diagnostic and all staged
 * edges to that id are dropped — no placeholder node is created.
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
  type ModelDecl,
  type AnnotationApplication,
  type Term,
  type ValueNode,
  type AssignmentNode,
} from "./ast.js";
import { PACKAGE_NODE_ID } from "../model/kinds.js";
import type { NodeId, Scalar } from "../model/graph.js";
import type { SourceFile, SourceSpan } from "../diagnostics/span.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";

export interface LoadResult {
  model: Repository;
  diagnostics: Diagnostic[];
}

interface RefSite {
  id: string;
  span: SourceSpan | null;
  node: NodeId | null;
  path: string | null;
}

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
// a prior compile — see checkAgainst). Same 3-pass pipeline as a fresh load. A
// reference that resolves to a node already in `model` is not reported undefined.
// Returns the accumulated diagnostics; the caller owns the model.
export function loadInto(model: Repository, sources: SourceFile[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const units: { ns: string; decl: Declaration }[] = [];
  for (const source of sources) {
    const result = parse(source.text, source.uri);
    diagnostics.push(...result.diagnostics);
    for (const decl of result.namespace.declarations) {
      units.push({ ns: result.namespace.path, decl });
    }
  }
  const declarations = units.map((u) => u.decl);

  detectOrphans(declarations, diagnostics);

  const defined = new Set<string>();
  const sites: RefSite[] = [];
  for (const declaration of declarations) collectNames(declaration, defined, sites);

  // Composition records nested in a taxonomy term (a `billing` record inside a
  // `technology` term) — deferred to pass 2b so they can bind to the term's
  // field once concept schemas are committed.
  const deferredCompositions: { ns: string; parentId: string; parentConcept: string; decl: InstanceDecl }[] = [];

  // Pass 1: bare type declarations. After all names are collected, any referenced
  // id absent from both the new sources and the existing model emits a
  // reference.undefined diagnostic and its edges are skipped by Builder.commit.
  const first = model.builder();
  for (const { ns, decl: declaration } of units) {
    first.setNamespace(ns);
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
                ns,
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
      case DeclKind.Annotation:
        first.defineAnnotation(declaration.name);
        break;
      case DeclKind.Instance:
      case DeclKind.Model:
      case DeclKind.Package:
        break; // instances/models staged in pass 2b; package applications in the applications pass
    }
  }
  const undefinedIds = new Set<string>();
  for (const site of sites) {
    if (defined.has(site.id) || model.has(site.id)) continue;
    undefinedIds.add(site.id);
    diagnostics.push({
      code: DiagnosticCode.ReferenceUndefined,
      severity: Severity.Error,
      message: `reference to undefined symbol "${site.id}"`,
      span: site.span,
      node: site.node,
      path: site.path,
    });
  }
  first.commit(undefinedIds);

  // Pass 2a: concept members (fields / relationships / invariants). Committing
  // these before instances lets a nested record consult the parent's schema.
  const second = model.builder();
  const invariants: PendingInvariant[] = [];
  for (const { ns, decl: declaration } of units) {
    if (declaration.kind === DeclKind.Annotation) {
      second.setNamespace(ns);
      for (const p of declaration.params) second.addField(declaration.name, p.name, p.type, p.cardinality);
      continue;
    }
    if (declaration.kind !== DeclKind.Concept) continue;
    second.setNamespace(ns);
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
  second.commit(undefinedIds);

  // Pass 2b: instances. The schema is committed, so a nested record binds to the
  // parent field typed by its concept (in addition to the structural Contains).
  const third = model.builder();
  const asserted = new Set<string>();
  for (const { ns, decl: declaration } of units) {
    third.setNamespace(ns);
    if (declaration.kind === DeclKind.Instance) {
      applyInstance(third, model, declaration, null, null, asserted, diagnostics);
    } else if (declaration.kind === DeclKind.Model) {
      applyModel(third, model, declaration, asserted, diagnostics);
    }
  }
  // Composition records nested in taxonomy terms — applied here so they bind to
  // the parent term's field against the now-committed concept schema.
  for (const composition of deferredCompositions) {
    third.setNamespace(composition.ns);
    applyInstance(third, model, composition.decl, composition.parentId, composition.parentConcept, asserted, diagnostics);
  }
  third.commit(undefinedIds);

  // Applications pass: annotation applications on concepts + package. Runs after
  // member schemas are committed. A duplicate `<target>@<Ann>` is diagnosed and
  // skipped (the builder would throw on the duplicate node id).
  const fourth = model.builder();
  const seenApps = new Set<string>();
  let packageStaged = false;
  for (const { ns, decl } of units) {
    if (decl.kind === DeclKind.Concept) {
      fourth.setNamespace(ns);
      stageApplications(fourth, model, decl.name, decl.annotations, seenApps, diagnostics);
    } else if (decl.kind === DeclKind.Package) {
      fourth.setNamespace(ns);
      if (!packageStaged) { fourth.definePackageNode(PACKAGE_NODE_ID); packageStaged = true; }
      stageApplications(fourth, model, PACKAGE_NODE_ID, decl.annotations, seenApps, diagnostics);
    }
  }
  fourth.commit(undefinedIds);

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
      case DeclKind.Model:
        model.recordSpan(declaration.id, declaration.span);
        if (declaration.metaModelSpan !== undefined) {
          model.recordSpan(Repository.memberKey(declaration.id, "meta-model"), declaration.metaModelSpan);
        }
        declaration.librarySpans?.forEach((s, i) =>
          model.recordSpan(Repository.memberKey(declaration.id, `uses.${i}`), s),
        );
        for (const inst of declaration.instances) recordInstanceSpans(model, inst);
        break;
      case DeclKind.Annotation:
        model.recordSpan(declaration.name, declaration.span);
        break;
      case DeclKind.Package:
        break; // application spans are recorded during the applications pass
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

function collectNames(declaration: Declaration, defined: Set<string>, sites: RefSite[]): void {
  switch (declaration.kind) {
    case DeclKind.Primitive:
      defined.add(declaration.name);
      break;
    case DeclKind.Taxonomy: {
      defined.add(declaration.name);
      for (let i = 0; i < declaration.represents.length; i++) {
        const concept = declaration.represents[i]!;
        sites.push({
          id: concept,
          span: declaration.representsSpans?.[i] ?? declaration.span,
          node: declaration.name,
          path: null,
        });
      }
      // Term nodes are taxonomy-qualified (see Builder.defineTaxonomy); record
      // every term's qualified id (nested included) so bare term values resolve,
      // and collect the refs their fixed relationships/compositions point at.
      const add = (t: Term): void => {
        defined.add(`${declaration.name}.${t.id}`);
        for (const assignment of t.assignments) {
          collectValueRefs(assignment.value, sites, `${declaration.name}.${t.id}`, assignment.name, assignment.span ?? null);
        }
        t.children.forEach(add);
      };
      declaration.terms.forEach(add);
      break;
    }
    case DeclKind.Concept:
      defined.add(declaration.name);
      if (declaration.extends !== null) {
        sites.push({
          id: declaration.extends,
          span: declaration.extendsSpan ?? declaration.span,
          node: declaration.name,
          path: null,
        });
      }
      for (const app of declaration.annotations) {
        sites.push({ id: app.name, span: app.nameSpan ?? app.span, node: `${declaration.name}@${app.name}`, path: null });
      }
      break;
    case DeclKind.Instance:
      collectInstanceNames(declaration, defined, sites);
      break;
    case DeclKind.Model:
      defined.add(declaration.id);
      for (const inst of declaration.instances) collectInstanceNames(inst, defined, sites);
      break;
    case DeclKind.Annotation:
      defined.add(declaration.name);
      break;
    case DeclKind.Package:
      for (const app of declaration.annotations) {
        sites.push({ id: app.name, span: app.nameSpan ?? app.span, node: `${PACKAGE_NODE_ID}@${app.name}`, path: null });
      }
      break;
  }
}

function collectInstanceNames(decl: InstanceDecl, defined: Set<string>, sites: RefSite[]): void {
  defined.add(decl.id);
  if (decl.instanceOf !== null) {
    sites.push({
      id: decl.instanceOf,
      span: decl.instanceOfSpan ?? decl.span,
      node: decl.id,
      path: null,
    });
  }
  for (const assignment of decl.assignments) {
    collectValueRefs(assignment.value, sites, decl.id, assignment.name, assignment.span ?? null);
  }
  for (const child of decl.children) collectInstanceNames(child, defined, sites);
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

function collectValueRefs(value: ValueNode, sites: RefSite[], ownerNode: NodeId, memberName: string, memberSpan: SourceSpan | null): void {
  switch (value.kind) {
    case ValueKind.Ref:
      sites.push({ id: value.ref, span: value.span ?? memberSpan ?? null, node: ownerNode, path: memberName });
      break;
    case ValueKind.Name:
      sites.push({ id: value.name, span: memberSpan ?? null, node: ownerNode, path: memberName });
      break;
    case ValueKind.List:
      for (const item of value.items) collectValueRefs(item, sites, ownerNode, memberName, memberSpan);
      break;
    case ValueKind.String:
    case ValueKind.Composite:
      break;
  }
}

/** File-level grouping keywords that wrap records but are not themselves records. */
const WRAPPER_CONCEPTS = new Set(["technology-library"]);

/**
 * A concrete object (`isClass = false`) is legal only inside a model. Walk the
 * top-level declarations: a `model` subtree is legal (skip it); any other
 * declaration is scanned for concrete objects with no model ancestor, and each
 * is flagged. Classes and transparent wrappers are recursed through, not flagged.
 */
function detectOrphans(declarations: Declaration[], diagnostics: Diagnostic[]): void {
  for (const declaration of declarations) {
    if (declaration.kind === DeclKind.Instance) flagOrphans(declaration, diagnostics);
  }
}

function flagOrphans(decl: InstanceDecl, diagnostics: Diagnostic[]): void {
  if (WRAPPER_CONCEPTS.has(decl.concept)) {
    for (const child of decl.children) flagOrphans(child, diagnostics);
    return;
  }
  if (decl.isClass) {
    for (const child of decl.children) flagOrphans(child, diagnostics);
    return;
  }
  diagnostics.push({
    code: DiagnosticCode.InstanceOrphan,
    severity: Severity.Error,
    message: `object "${decl.id}" must be declared inside a model`,
    span: decl.conceptSpan ?? decl.span,
    node: decl.id,
    path: null,
  });
}

/**
 * Stage each annotation application on `target` as `<target>@<name>` (typed by
 * the annotation) plus its scalar param attrs. A repeated application on the same
 * target is diagnosed (`annotation.duplicate`) and skipped — the first wins.
 */
function stageApplications(
  builder: Builder,
  model: Repository,
  target: string,
  apps: readonly AnnotationApplication[],
  seen: Set<string>,
  diagnostics: Diagnostic[],
): void {
  for (const app of apps) {
    const appId = `${target}@${app.name}`;
    if (seen.has(appId)) {
      diagnostics.push({
        code: DiagnosticCode.AnnotationDuplicate,
        severity: Severity.Error,
        message: `annotation "${app.name}" is already applied to "${target}"`,
        span: app.nameSpan ?? app.span,
        node: appId,
        path: null,
      });
      continue;
    }
    seen.add(appId);
    builder.annotate(target, app.name);
    model.recordSpan(appId, app.span);
    for (const a of app.assignments) applyValue(builder, appId, a.name, a.value);
  }
}

/** Stage a model container node and its contained objects (rooted via Contains). */
function applyModel(
  builder: Builder,
  model: Repository,
  decl: ModelDecl,
  asserted: Set<string>,
  diagnostics: Diagnostic[],
): void {
  builder.assertModel(decl.id);
  builder.setField(decl.id, "id", decl.id);
  builder.setField(decl.id, "meta-model", decl.metaModel);
  builder.setField(decl.id, "uses.count", decl.libraries.length);
  decl.libraries.forEach((lib, i) => builder.setField(decl.id, `uses.${i}`, lib));
  asserted.add(decl.id);
  for (const child of decl.instances) {
    applyInstance(builder, model, child, decl.id, null, asserted, diagnostics);
  }
}

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
