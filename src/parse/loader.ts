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
import { makeResolver, type Home } from "../resolve/resolver.js";
import { PACKAGE_NODE_ID, MetaKind } from "../model/kinds.js";
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
  home: Home;
  /** Rewrite the AST field/value this reference came from to a flat id — used
   * when a qualified `ns.x` resolves to the flat node `x`, or a bare term ref
   * resolves to its taxonomy-qualified sibling. */
  rewrite?: (id: string) => void;
  /** Set for a reference inside a term body: the enclosing taxonomy and its
   * (already flat-normalized) `uses` list, for sibling / cross-taxonomy bare
   * resolution. */
  scope?: { taxonomy: string; uses: readonly string[] };
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
export function loadInto(
  model: Repository,
  sources: SourceFile[],
  reserved: ReadonlySet<string> = new Set(),
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const units: { ns: string; imports: readonly string[]; decl: Declaration }[] = [];
  for (const source of sources) {
    const result = parse(source.text, source.uri);
    diagnostics.push(...result.diagnostics);
    for (const decl of result.namespace.declarations) {
      units.push({ ns: result.namespace.path, imports: result.namespace.imports, decl });
    }
  }

  // A source that redeclares a name the default library (prelude) already
  // provides is warned and DROPPED — the prelude wins (it is the foundation
  // base), and re-defining the same node id would otherwise make the builder
  // throw on the duplicate. Named ontology declarations carry `.name` + `.span`.
  const active = units.filter(({ decl }) => {
    const named =
      decl.kind === DeclKind.Primitive ||
      decl.kind === DeclKind.Concept ||
      decl.kind === DeclKind.Annotation ||
      decl.kind === DeclKind.Taxonomy;
    if (reserved.size > 0 && named && reserved.has(decl.name)) {
      diagnostics.push({
        code: DiagnosticCode.PreludeNameRedeclared,
        severity: Severity.Warning,
        message: `"${decl.name}" is provided by the default library; remove the local declaration`,
        span: decl.span,
        node: decl.name,
        path: null,
      });
      return false;
    }
    return true;
  });
  units.length = 0;
  units.push(...active);

  const declarations = units.map((u) => u.decl);

  detectOrphans(declarations, diagnostics);

  const defined = new Set<string>();
  const sites: RefSite[] = [];
  // Namespace of each SOURCE-defined id (base nodes carry their ns as a
  // `namespace` attr). Drives the reachability gate below.
  const sourceNs = new Map<string, string>();
  for (const { ns, imports, decl } of units) collectNames(decl, { ns, imports }, defined, sites, sourceNs);

  // ---- Namespace-scoped resolution (design: unified-reference-resolver) ----
  // The single resolver module gates every reference by namespace reachability
  // (own ns / imports / global) and resolves qualified `ns.x` to its flat node.
  const undefinedIds = new Set<string>();
  const { nsOf, exists, reachable, resolveRef } = makeResolver(model, defined, sourceNs, reserved);

  // Normalize + validate `uses` targets FIRST — the term-body scope resolution
  // below reads each taxonomy's (flat) `uses` list to form `used.term`
  // candidates, so qualified `uses ns.tax` must be rewritten to flat `tax`
  // beforehand. Each target must resolve (via ns / import / qualifier) to a
  // known taxonomy. Mutating decl.uses in place updates the same array the
  // captured term `scope` holds.
  const isTaxonomy = (id: string): boolean => {
    for (const decl of declarations) if (decl.kind === DeclKind.Taxonomy && decl.name === id) return true;
    return model.resolve(id)?.typeOf === MetaKind.Taxonomy;
  };
  for (const { ns, imports, decl } of units) {
    if (decl.kind !== DeclKind.Taxonomy) continue;
    const home: Home = { ns, imports };
    decl.uses.forEach((u, i) => {
      const r = resolveRef(u, home);
      const flat = r.kind === "qualified" ? r.flat : u;
      if (r.kind === "qualified") decl.uses[i] = flat;
      if ((r.kind === "ok" || r.kind === "qualified") && isTaxonomy(flat)) return;
      diagnostics.push({
        code: DiagnosticCode.TaxonomyUsesUndefined,
        severity: Severity.Error,
        message: r.kind === "unreachable"
          ? `taxonomy "${decl.name}" uses "${u}", which is defined in namespace "${r.ns}" but not imported here — add \`import ${r.ns};\``
          : `taxonomy "${decl.name}" uses "${u}", which is not a known taxonomy`,
        span: decl.usesSpans?.[i] ?? decl.span,
        node: decl.name,
        path: null,
      });
    });
  }

  // Resolve references BEFORE Pass 1 — Pass 1's defineTaxonomy reads term value
  // refs, so any rewrite must be applied first. A qualified name is rewritten to
  // its flat id; a bare term-body ref resolves against the enclosing taxonomy's
  // own terms (sibling shadows `uses`) even when the bare id also exists
  // unreachably elsewhere. Anything unresolved is reference.undefined /
  // reference.unreachable and its edges are dropped by Builder.commit.
  for (const site of sites) {
    const r = resolveRef(site.id, site.home);
    if (r.kind === "ok") continue;
    if (r.kind === "qualified") { site.rewrite?.(r.flat); continue; }
    if (site.scope !== undefined) {
      const sibling = `${site.scope.taxonomy}.${site.id}`;
      if (exists(sibling) && reachable(sibling, site.home)) { site.rewrite?.(sibling); continue; }
      const matches = site.scope.uses
        .map((u) => `${u}.${site.id}`)
        .filter((cand) => exists(cand) && reachable(cand, site.home));
      if (matches.length === 1) { site.rewrite?.(matches[0]!); continue; }
      if (matches.length > 1) {
        diagnostics.push({
          code: DiagnosticCode.TaxonomyAmbiguousBareReference,
          severity: Severity.Error,
          message: `bare reference "${site.id}" is defined by more than one used taxonomy (${matches.join(", ")}); qualify it`,
          span: site.span,
          node: site.node,
          path: site.path,
        });
        continue;
      }
    }
    undefinedIds.add(site.id);
    diagnostics.push(r.kind === "unreachable"
      ? {
          code: DiagnosticCode.ReferenceUnreachable,
          severity: Severity.Error,
          message: `reference to "${site.id}", which is defined in namespace "${r.ns}" but not imported here — add \`import ${r.ns};\``,
          span: site.span, node: site.node, path: site.path,
        }
      : {
          code: DiagnosticCode.ReferenceUndefined,
          severity: Severity.Error,
          message: `reference to undefined symbol "${site.id}"`,
          span: site.span, node: site.node, path: site.path,
        });
  }

  // Composition records nested in a taxonomy term (a `billing` record inside a
  // `technology` term) — deferred to pass 2b so they can bind to the term's
  // field once concept schemas are committed.
  const deferredCompositions: { ns: string; parentId: string; parentConcept: string; decl: InstanceDecl }[] = [];

  // Pass 1: bare type declarations. Any referenced id absent from both the new
  // sources and the existing model was flagged above and its edges are skipped
  // by Builder.commit.
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
      case DeclKind.Concept: {
        // A parent-less concept implicitly extends the prelude root `element`
        // (when it is in scope). `element` itself, and a raw `load` with no
        // prelude base, keep their declared (null) parent. The synthetic parent
        // is a base node, so it never yields a reference.undefined.
        const parent = declaration.extends
          ?? (declaration.name !== "element" && model.has("element") ? "element" : null);
        first.defineConcept(declaration.name, parent);
        break;
      }
      case DeclKind.Annotation:
        first.defineAnnotation(declaration.name);
        break;
      case DeclKind.Instance:
      case DeclKind.Model:
      case DeclKind.Package:
        break; // instances/models staged in pass 2b; package applications in the applications pass
    }
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
    } else if (decl.kind === DeclKind.Taxonomy) {
      fourth.setNamespace(ns);
      // Taxonomy-level annotations decorate the taxonomy node itself
      // (`<taxonomy>@<name>`), exactly like a concept.
      stageApplications(fourth, model, decl.name, decl.annotations, seenApps, diagnostics);
      const walkTerm = (t: Term): void => {
        if (t.annotations.length > 0) {
          stageApplications(fourth, model, `${decl.name}.${t.id}`, t.annotations, seenApps, diagnostics);
        }
        t.children.forEach(walkTerm);
      };
      decl.terms.forEach(walkTerm);
    } else if (decl.kind === DeclKind.Instance) {
      fourth.setNamespace(ns);
      stageInstanceAnnotations(fourth, model, decl, seenApps, diagnostics);
    } else if (decl.kind === DeclKind.Model) {
      fourth.setNamespace(ns);
      for (const inst of decl.instances) stageInstanceAnnotations(fourth, model, inst, seenApps, diagnostics);
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

function collectNames(
  declaration: Declaration,
  home: Home,
  defined: Set<string>,
  sites: RefSite[],
  sourceNs: Map<string, string>,
): void {
  const define = (id: string): void => { defined.add(id); sourceNs.set(id, home.ns); };
  const annotationSite = (app: AnnotationApplication, node: NodeId): void => {
    sites.push({ id: app.name, span: app.nameSpan ?? app.span, node, path: null, home, rewrite: (r) => { app.name = r; } });
  };
  switch (declaration.kind) {
    case DeclKind.Primitive:
      define(declaration.name);
      break;
    case DeclKind.Taxonomy: {
      const decl = declaration;
      define(decl.name);
      for (let i = 0; i < decl.represents.length; i++) {
        const idx = i;
        sites.push({
          id: decl.represents[i]!,
          span: decl.representsSpans?.[i] ?? decl.span,
          node: decl.name,
          path: null,
          home,
          rewrite: (r) => { decl.represents[idx] = r; },
        });
      }
      for (const app of decl.annotations) annotationSite(app, `${decl.name}@${app.name}`);
      // Term nodes are taxonomy-qualified (see Builder.defineTaxonomy); record
      // every term's qualified id (nested included) so bare term values resolve,
      // and collect the refs their fixed relationships/compositions point at.
      const scope = { taxonomy: decl.name, uses: decl.uses };
      const add = (t: Term): void => {
        define(`${decl.name}.${t.id}`);
        for (const assignment of t.assignments) {
          collectValueRefs(assignment.value, sites, `${decl.name}.${t.id}`, assignment.name, assignment.span ?? null, home, scope);
        }
        t.children.forEach(add);
      };
      decl.terms.forEach(add);
      break;
    }
    case DeclKind.Concept:
      define(declaration.name);
      if (declaration.extends !== null) {
        const decl = declaration;
        sites.push({
          id: decl.extends!,
          span: decl.extendsSpan ?? decl.span,
          node: decl.name,
          path: null,
          home,
          rewrite: (r) => { (decl as { extends: string | null }).extends = r; },
        });
      }
      for (const app of declaration.annotations) annotationSite(app, `${declaration.name}@${app.name}`);
      break;
    case DeclKind.Instance:
      collectInstanceNames(declaration, home, defined, sites, sourceNs);
      break;
    case DeclKind.Model:
      define(declaration.id);
      for (const inst of declaration.instances) collectInstanceNames(inst, home, defined, sites, sourceNs);
      break;
    case DeclKind.Annotation:
      define(declaration.name);
      break;
    case DeclKind.Package:
      for (const app of declaration.annotations) annotationSite(app, `${PACKAGE_NODE_ID}@${app.name}`);
      break;
  }
}

function collectInstanceNames(
  decl: InstanceDecl,
  home: Home,
  defined: Set<string>,
  sites: RefSite[],
  sourceNs: Map<string, string>,
): void {
  defined.add(decl.id);
  sourceNs.set(decl.id, home.ns);
  if (decl.instanceOf !== null) {
    sites.push({
      id: decl.instanceOf,
      span: decl.instanceOfSpan ?? decl.span,
      node: decl.id,
      path: null,
      home,
      rewrite: (r) => { (decl as { instanceOf: string | null }).instanceOf = r; },
    });
  }
  for (const assignment of decl.assignments) {
    collectValueRefs(assignment.value, sites, decl.id, assignment.name, assignment.span ?? null, home);
  }
  for (const child of decl.children) collectInstanceNames(child, home, defined, sites, sourceNs);
}

/** A term's scalar fixed-value fields (String/Name/Composite) as an attr map.
 * `Ref`/`List` assignments are domain relationships — see {@link termRelationships}. */
function termAttrs(assignments: AssignmentNode[]): Map<string, Scalar> {
  const attrs = new Map<string, Scalar>();
  for (const assignment of assignments) {
    const value = assignment.value;
    if (value.kind === ValueKind.String) attrs.set(assignment.name, value.text);
    else if (value.kind === ValueKind.Boolean) attrs.set(assignment.name, value.value);
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
    annotations: [],
    span: t.span,
  };
}

function collectValueRefs(
  value: ValueNode,
  sites: RefSite[],
  ownerNode: NodeId,
  memberName: string,
  memberSpan: SourceSpan | null,
  home: Home,
  scope?: { taxonomy: string; uses: readonly string[] },
): void {
  switch (value.kind) {
    case ValueKind.Ref:
      sites.push({
        id: value.ref, span: value.span ?? memberSpan ?? null, node: ownerNode, path: memberName, home,
        rewrite: (r) => { (value as { ref: string }).ref = r; },
        ...(scope ? { scope } : {}),
      });
      break;
    case ValueKind.Name:
      sites.push({
        id: value.name, span: memberSpan ?? null, node: ownerNode, path: memberName, home,
        rewrite: (r) => { (value as { name: string }).name = r; },
        ...(scope ? { scope } : {}),
      });
      break;
    case ValueKind.List:
      for (const item of value.items) collectValueRefs(item, sites, ownerNode, memberName, memberSpan, home, scope);
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

/** Stage annotations on a class instance; reject them on a concrete instance
 * (`annotation.invalid-target`). Recurses into nested records. */
function stageInstanceAnnotations(
  builder: Builder,
  model: Repository,
  decl: InstanceDecl,
  seen: Set<string>,
  diagnostics: Diagnostic[],
): void {
  if (decl.annotations.length > 0) {
    if (decl.isClass) {
      stageApplications(builder, model, decl.id, decl.annotations, seen, diagnostics);
    } else {
      for (const app of decl.annotations) {
        diagnostics.push({
          code: DiagnosticCode.AnnotationInvalidTarget,
          severity: Severity.Error,
          message: `annotation "${app.name}" cannot be applied to concrete instance "${decl.id}" — annotations are type-level (allowed on concepts, taxonomies, taxonomy terms, classes, and the package)`,
          span: app.nameSpan ?? app.span,
          node: decl.id,
          path: null,
        });
      }
    }
  }
  for (const child of decl.children) stageInstanceAnnotations(builder, model, child, seen, diagnostics);
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
    case ValueKind.Boolean:
      builder.setField(id, name, value.value);
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
