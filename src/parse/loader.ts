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
  type ObjectValue,
  type AssignmentNode,
} from "./ast.js";
import { type IdGenerator, SnowflakeIdGenerator } from "../model/id-generator.js";
import { makeResolver, type Home } from "../resolve/resolver.js";
import { collectDefinitions, visitReferences } from "./references.js";
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

export function load(sources: SourceFile[], idGenerator: IdGenerator = new SnowflakeIdGenerator()): LoadResult {
  const model = new Repository();
  const diagnostics = loadInto(model, sources, new Set(), idGenerator);
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
  idGenerator: IdGenerator = new SnowflakeIdGenerator(),
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const units: { ns: string; imports: readonly string[]; uri: string; decl: Declaration }[] = [];
  for (const source of sources) {
    const result = parse(source.text, source.uri);
    diagnostics.push(...result.diagnostics);
    for (const decl of result.namespace.declarations) {
      units.push({ ns: result.namespace.path, imports: result.namespace.imports, uri: source.uri, decl });
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
  for (const { ns, imports, decl } of units) {
    collectDefinitions(decl, ns, defined, sourceNs);
    const home: Home = { ns, imports };
    visitReferences(decl, (v) => {
      sites.push({ id: v.name, span: v.span ?? null, node: v.ownerNode, path: v.memberPath, home, rewrite: v.rewrite, ...(v.scope ? { scope: v.scope } : {}) });
    });
  }

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
  const isViewpoint = (id: string): boolean => {
    for (const decl of declarations) if (decl.kind === DeclKind.Viewpoint && decl.name === id) return true;
    return model.resolve(id)?.typeOf === MetaKind.Viewpoint;
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

  // A model's `uses` list is the same shape as a taxonomy's: taxonomy names that
  // form a term-drop scope for the model's instance value refs. Normalize each
  // qualified `ns.tax` to its flat id in place (the captured scope holds the same
  // `decl.libraries` array) and require each to resolve to a known taxonomy.
  for (const { ns, imports, decl } of units) {
    if (decl.kind !== DeclKind.Model) continue;
    const home: Home = { ns, imports };
    decl.libraries.forEach((u, i) => {
      const r = resolveRef(u, home);
      const flat = r.kind === "qualified" ? r.flat : u;
      if (r.kind === "qualified") decl.libraries[i] = flat;
      if ((r.kind === "ok" || r.kind === "qualified") && isTaxonomy(flat)) return;
      diagnostics.push({
        code: DiagnosticCode.TaxonomyUsesUndefined,
        severity: Severity.Error,
        message: r.kind === "unreachable"
          ? `model "${decl.id}" uses "${u}", which is defined in namespace "${r.ns}" but not imported here — add \`import ${r.ns};\``
          : `model "${decl.id}" uses "${u}", which is not a known taxonomy`,
        span: decl.librarySpans?.[i] ?? decl.span,
        node: decl.id,
        path: null,
      });
    });
  }

  // A model's `conforms <viewpoint>` binds the viewpoint it homes entities for.
  // Resolve it (rewrite qualified → flat) and require it to be a viewpoint.
  for (const { ns, imports, decl } of units) {
    if (decl.kind !== DeclKind.Model || decl.conforms === null) continue;
    const home: Home = { ns, imports };
    const r = resolveRef(decl.conforms, home);
    const flat = r.kind === "qualified" ? r.flat : decl.conforms;
    if (r.kind === "qualified") decl.conforms = flat;
    if ((r.kind === "ok" || r.kind === "qualified") && isViewpoint(flat)) continue;
    diagnostics.push({
      code: DiagnosticCode.ModelConformsNotViewpoint,
      severity: Severity.Error,
      message: r.kind === "unreachable"
        ? `model "${decl.id}" conforms to "${decl.conforms}", which is defined in namespace "${r.ns}" but not imported here — add \`import ${r.ns};\``
        : `model "${decl.id}" conforms to "${decl.conforms}", which is not a known viewpoint`,
      span: decl.conformsSpan ?? decl.span,
      node: decl.id,
      path: null,
    });
  }

  // A model split across MORE THAN ONE file must declare `conforms <viewpoint>`
  // in every contributing block (the viewpoint is the per-file home discriminator).
  // A single-file model may omit it.
  const modelBlocks = new Map<string, { uris: Set<string>; blocks: ModelDecl[] }>();
  for (const { uri, decl } of units) {
    if (decl.kind !== DeclKind.Model) continue;
    const entry = modelBlocks.get(decl.id) ?? { uris: new Set<string>(), blocks: [] };
    entry.uris.add(uri);
    entry.blocks.push(decl);
    modelBlocks.set(decl.id, entry);
  }
  for (const [id, { uris, blocks }] of modelBlocks) {
    if (uris.size < 2) continue;
    for (const decl of blocks) {
      if (decl.conforms === null) {
        diagnostics.push({
          code: DiagnosticCode.ModelConformsRequiredWhenSplit,
          severity: Severity.Error,
          message: `model "${id}" is split across multiple files, so each block must declare \`conforms <viewpoint>\``,
          span: decl.span,
          node: id,
          path: null,
        });
      }
    }
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
      // A model scope has no enclosing taxonomy (empty sibling slot); only the
      // `uses` candidates below apply. A taxonomy-body scope tries its sibling first.
      const sibling = site.scope.taxonomy ? `${site.scope.taxonomy}.${site.id}` : "";
      if (sibling && exists(sibling) && reachable(sibling, site.home)) { site.rewrite?.(sibling); continue; }
      const matches = site.scope.uses
        .map((u) => `${u}.${site.id}`)
        .filter((cand) => exists(cand) && reachable(cand, site.home));
      if (matches.length === 1) { site.rewrite?.(matches[0]!); continue; }
      if (matches.length > 1) {
        diagnostics.push({
          code: DiagnosticCode.TaxonomyAmbiguousBareReference,
          severity: Severity.Error,
          message: `Bare reference "${site.id}" is defined by more than one used taxonomy (${matches.join(", ")}); Qualify it`,
          span: site.span,
          node: site.node,
          path: site.path,
        });
        undefinedIds.add(site.id); // unresolved: drop the edge so commit doesn't dangle
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
  // Term assignments whose realization (attr vs edge) depends on the represented
  // concept's schema — deferred until schemas commit (Pass 2a), then applied in
  // Pass 2b through the shared type-directed helper.
  const deferredTermValues: { ns: string; concept: string; termId: string; name: string; value: ValueNode }[] = [];

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
      case DeclKind.Viewpoint:
        first.defineViewpoint(declaration.name, declaration.frames);
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
          // Literal scalars (String/Boolean) are unambiguously attrs; everything
          // else (Name/List/Composite) is classified by the concept schema and
          // deferred to Pass 2b.
          for (const assignment of t.assignments) {
            const v = assignment.value;
            if (v.kind !== ValueKind.String && v.kind !== ValueKind.Boolean) {
              deferredTermValues.push({ ns, concept: ownConcept, termId: `${decl.name}.${t.id}`, name: assignment.name, value: v });
            }
          }
          return {
            id: t.id,
            ...(t.concept !== null ? { concept: t.concept } : {}),
            attrs: termLiteralAttrs(t.assignments),
            relationships: [],
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
          ?? (declaration.name !== "Element" && model.has("Element") ? "Element" : null);
        first.defineConcept(declaration.name, parent);
        break;
      }
      case DeclKind.Annotation:
        first.defineAnnotation(declaration.name, declaration.extends ?? null);
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
      second.addConceptRelationship(declaration.name, relationship.name, relationship.targets, relationship.cardinality);
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
      applyInstance(third, model, declaration, null, null, asserted, diagnostics, idGenerator);
    } else if (declaration.kind === DeclKind.Model) {
      applyModel(third, model, declaration, asserted, diagnostics, idGenerator);
    }
  }
  // Composition records nested in taxonomy terms — applied here so they bind to
  // the parent term's field against the now-committed concept schema.
  for (const composition of deferredCompositions) {
    third.setNamespace(composition.ns);
    applyInstance(third, model, composition.decl, composition.parentId, composition.parentConcept, asserted, diagnostics, idGenerator);
  }
  // Term values classified by the now-committed concept schema (type-directed).
  for (const d of deferredTermValues) {
    third.setNamespace(d.ns);
    realizeValue(third, model, d.concept, d.termId, d.name, d.value, diagnostics, asserted, idGenerator);
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
      stageApplications(fourth, model, decl.name, decl.annotations, seenApps, diagnostics, asserted, idGenerator);
      // Member-level annotations decorate the member node (`<concept>.<member>@<Ann>`).
      for (const rel of decl.relationships) {
        if (rel.annotations.length > 0)
          stageApplications(fourth, model, `${decl.name}.${rel.name}`, rel.annotations, seenApps, diagnostics, asserted, idGenerator);
      }
    } else if (decl.kind === DeclKind.Package) {
      fourth.setNamespace(ns);
      if (!packageStaged) { fourth.definePackageNode(PACKAGE_NODE_ID); packageStaged = true; }
      stageApplications(fourth, model, PACKAGE_NODE_ID, decl.annotations, seenApps, diagnostics, asserted, idGenerator);
    } else if (decl.kind === DeclKind.Taxonomy) {
      fourth.setNamespace(ns);
      // Taxonomy-level annotations decorate the taxonomy node itself
      // (`<taxonomy>@<name>`), exactly like a concept.
      stageApplications(fourth, model, decl.name, decl.annotations, seenApps, diagnostics, asserted, idGenerator);
      const walkTerm = (t: Term): void => {
        if (t.annotations.length > 0) {
          stageApplications(fourth, model, `${decl.name}.${t.id}`, t.annotations, seenApps, diagnostics, asserted, idGenerator);
        }
        t.children.forEach(walkTerm);
      };
      decl.terms.forEach(walkTerm);
    } else if (decl.kind === DeclKind.Instance) {
      fourth.setNamespace(ns);
      stageInstanceAnnotations(fourth, model, decl, seenApps, diagnostics, asserted, idGenerator);
    } else if (decl.kind === DeclKind.Model) {
      fourth.setNamespace(ns);
      for (const inst of decl.instances) stageInstanceAnnotations(fourth, model, inst, seenApps, diagnostics, asserted, idGenerator);
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
      case DeclKind.Viewpoint:
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
        if (declaration.conformsSpan !== undefined) {
          model.recordSpan(Repository.memberKey(declaration.id, "conforms"), declaration.conformsSpan);
        }
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


/** A type is reference-like when it resolves to a concept or taxonomy node;
 * primitives and unresolved ids are value-like. */
function isReferenceType(model: Repository, type: string | undefined): boolean {
  if (type === undefined) return false;
  const kind = model.resolve(type)?.typeOf;
  return kind === MetaKind.Concept || kind === MetaKind.Taxonomy;
}

/** A member is reference-like when it is a `->` relationship, or a `:` field
 * whose declared type is reference-like. Reads the effective (inherited) schema
 * of `concept`, so schemas must be committed before this is called. */
function isReferenceMember(model: Repository, concept: string, name: string): boolean {
  const schema = model.effectiveSchema(concept);
  if (schema.relationships.some((r) => r.name === name)) return true;
  const field = schema.fields.find((f) => f.name === name);
  return field !== undefined && isReferenceType(model, field.type);
}

/** A term's literal scalar attrs only (String/Boolean). Name/List/Composite are
 * deferred and classified by the represented concept's schema after it commits. */
function termLiteralAttrs(assignments: AssignmentNode[]): Map<string, Scalar> {
  const attrs = new Map<string, Scalar>();
  for (const assignment of assignments) {
    const value = assignment.value;
    if (value.kind === ValueKind.String) attrs.set(assignment.name, value.text);
    else if (value.kind === ValueKind.Boolean) attrs.set(assignment.name, value.value);
  }
  return attrs;
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
  asserted: Set<string>,
  idGen: IdGenerator,
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
    for (const a of app.assignments) realizeValue(builder, model, app.name, appId, a.name, a.value, diagnostics, asserted, idGen);
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
  asserted: Set<string>,
  idGen: IdGenerator,
): void {
  if (decl.annotations.length > 0) {
    if (decl.isClass) {
      stageApplications(builder, model, decl.id, decl.annotations, seen, diagnostics, asserted, idGen);
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
  for (const child of decl.children) stageInstanceAnnotations(builder, model, child, seen, diagnostics, asserted, idGen);
}

/** Stage a model container node and its contained objects (rooted via Contains). */
function applyModel(
  builder: Builder,
  model: Repository,
  decl: ModelDecl,
  asserted: Set<string>,
  diagnostics: Diagnostic[],
  idGen: IdGenerator,
): void {
  // A model may be split across several files (Option B): same id, one node.
  // Assert the container + its model-level fields only on first sight; later
  // same-id blocks merge their instances into it.
  if (!asserted.has(decl.id)) {
    builder.assertModel(decl.id);
    builder.setField(decl.id, "id", decl.id);
    builder.setField(decl.id, "MetaModel", decl.metaModel);
    builder.setField(decl.id, "uses.count", decl.libraries.length);
    decl.libraries.forEach((lib, i) => builder.setField(decl.id, `uses.${i}`, lib));
    asserted.add(decl.id);
  }
  for (const child of decl.instances) {
    applyInstance(builder, model, child, decl.id, null, asserted, diagnostics, idGen);
    // `conforms` is a per-FILE (per-block) home viewpoint: stamp each concrete
    // top-level entity so a model split across files keeps each entity's own
    // viewpoint after the model nodes merge.
    if (decl.conforms !== null && !child.isClass && !WRAPPER_CONCEPTS.has(child.concept)) {
      builder.setField(child.id, "conforms", decl.conforms);
    }
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
  idGen: IdGenerator,
): void {
  // A `technology-library` is a transparent file wrapper (not an EA concept);
  // its members are top-level records. Skipping the container node also avoids
  // a legacy id collision (the aws library names both its container and its
  // root location `aws`).
  if (WRAPPER_CONCEPTS.has(decl.concept)) {
    for (const child of decl.children) applyInstance(builder, model, child, null, null, asserted, diagnostics, idGen);
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
    if (decl.binds !== null) builder.setField(decl.id, "MetaModel", decl.binds);
    if (decl.instanceOf !== null) builder.addInstanceOf(decl.id, decl.instanceOf);
    if (parent !== null) {
      builder.addContains(parent, decl.id);
      if (parentConcept !== null) bindToField(builder, model, parent, parentConcept, decl, diagnostics);
    }
  }
  for (const assignment of decl.assignments) {
    realizeValue(builder, model, decl.concept, decl.id, assignment.name, assignment.value, diagnostics, asserted, idGen);
  }
  for (const child of decl.children) {
    applyInstance(builder, model, child, decl.id, decl.concept, asserted, diagnostics, idGen);
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

/** Realize one authored assignment onto `id`, choosing attr vs edge from the
 * member's declared type (not the value's syntax). Shared by the instance pass
 * and the deferred-term pass. */
function realizeValue(
  builder: Builder,
  model: Repository,
  concept: string,
  id: string,
  name: string,
  value: ValueNode,
  diagnostics: Diagnostic[],
  asserted: Set<string>,
  idGen: IdGenerator,
): void {
  const reference = isReferenceMember(model, concept, name);
  const mismatch = (msg: string): void => {
    diagnostics.push({
      code: DiagnosticCode.MemberValueKind,
      severity: Severity.Error,
      message: msg,
      span: null,
      node: id,
      path: `${concept}.${name}`,
    });
  };

  switch (value.kind) {
    case ValueKind.String:
      if (reference) return mismatch(`"${concept}.${name}" is a reference — expected a name, not a quoted string`);
      builder.setField(id, name, value.text);
      break;
    case ValueKind.Boolean:
      if (reference) return mismatch(`"${concept}.${name}" is a reference — expected a name, not a boolean`);
      builder.setField(id, name, value.value);
      break;
    case ValueKind.Name:
      if (reference) builder.addRelationship(id, name, value.name);
      else builder.setField(id, name, value.name);
      break;
    case ValueKind.List:
      for (const item of value.items) realizeValue(builder, model, concept, id, name, item, diagnostics, asserted, idGen);
      break;
    case ValueKind.Object:
      realizeInlineObject(builder, model, concept, id, name, value, diagnostics, asserted, idGen);
      break;
    case ValueKind.Composite:
      if (reference) {
        // A `|`-composed selection of taxonomy terms → one edge per part.
        for (const part of value.parts) builder.addRelationship(id, name, part);
      } else {
        // Enum-flag scalar kept as the legacy `|`-joined string; the runtime
        // enum table's has() splits on `|`.
        builder.setField(id, name, value.parts.join(" | "));
      }
      break;
  }
}

/** Materialise a typed inline object assigned to `owner.field`: a contained node
 * bound to the explicitly-named field, with an id from the `id =` assignment or
 * the injected generator. Reuses `applyInstance` for the body (assignments +
 * nested records); annotations inside an inline object are the v1 deferral. */
function realizeInlineObject(
  builder: Builder,
  model: Repository,
  ownerConcept: string,
  owner: string,
  field: string,
  value: ObjectValue,
  diagnostics: Diagnostic[],
  asserted: Set<string>,
  idGen: IdGenerator,
): void {
  const idAssign = value.assignments.find((a) => a.name === "id");
  const objId = idAssign !== undefined ? nameOfValue(idAssign.value) : idGen.next();
  const synth: InstanceDecl = {
    kind: DeclKind.Instance,
    concept: value.concept,
    id: objId,
    binds: null,
    isClass: false,
    instanceOf: null,
    assignments: value.assignments.filter((a) => a.name !== "id"),
    children: value.children,
    annotations: [],
    span: value.span,
  };
  applyInstance(builder, model, synth, null, null, asserted, diagnostics, idGen);
  builder.addContains(owner, objId);
  builder.addRelationship(owner, field, objId);
}

/** The bare string of a name/string value — used to read an inline object's `id =`. */
function nameOfValue(v: ValueNode): string {
  if (v.kind === ValueKind.Name) return v.name;
  if (v.kind === ValueKind.String) return v.text;
  return "";
}

/** Test-only surface for the type-directed classification helpers. */
export const __test__ = { isReferenceType, isReferenceMember };
