import type { Entity } from "./entity.js";
import type { Repository } from "./model.js";
import type { Scalar, Cardinality } from "./graph.js";

/** A read-only, JSON-serializable projection of a model node. Referenced
 *  aggregates and linked elements are resolved inline (deep); a node already
 *  expanded upstream collapses to a `truncated` node (own facets, empty subtree). */
export interface Element {
  id: string;
  concept: string;
  fields: Record<string, Scalar>;
  refs: Record<string, Element[]>;
  schema: ElementSchema;
  provenance: Provenance;
  presentation: PresentationHint;
  referredBy?: IncomingRef[];
  truncated?: true;
}

export interface ElementSchema {
  concept: string;
  extends: string | null;
  fields: { name: string; type: string; cardinality: Cardinality }[];
  relationships: { name: string; targets: string[]; cardinality: Cardinality; inverse: string | null }[];
}

export interface Provenance {
  home?: string;
  conforms?: string;
}

export interface IncomingRef {
  id: string;
  concept: string;
  via: string;
}

export interface PresentationHint {
  label: string;
  iconKey?: string | null;
}

export interface ToElementOptions {
  maxDepth?: number;
  presentation?: (e: Entity, defaultLabel: string) => PresentationHint;
  homeOf?: (id: string) => string | undefined;
}

export function toElement(repo: Repository, entity: Entity, opts: ToElementOptions = {}): Element {
  return build(repo, entity, new Set<string>(), 0, true, opts);
}

function build(repo: Repository, e: Entity, seen: Set<string>, depth: number, isRoot: boolean, opts: ToElementOptions): Element {
  const label = defaultLabel(e);
  const node: Element = {
    id: e.id,
    concept: e.concept,
    fields: fieldsOf(e),
    refs: {},
    schema: schemaOf(e),
    provenance: provenanceOf(repo, e, opts),
    presentation: opts.presentation !== undefined ? opts.presentation(e, label) : { label },
  };
  if (isRoot) node.referredBy = incomingRefs(e);

  if (seen.has(e.id)) { node.truncated = true; return node; }
  if (opts.maxDepth !== undefined && depth >= opts.maxDepth) return node;

  seen.add(e.id);
  for (const rel of e.schema().relationships) {
    const targets = e.refs(rel.name);
    if (targets.length === 0) continue;
    node.refs[rel.name] = targets.map((t) => build(repo, t, seen, depth + 1, false, opts));
  }
  return node;
}

function defaultLabel(e: Entity): string {
  const v = e.field("label") ?? e.field("name");
  return v !== undefined ? String(v) : e.id;
}

function fieldsOf(e: Entity): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of e.fields) out[k] = v;
  return out;
}

function schemaOf(e: Entity): ElementSchema {
  const s = e.schema();
  return {
    concept: s.concept,
    extends: s.extends,
    fields: s.fields.map((f) => ({ name: f.name, type: f.type, cardinality: f.cardinality })),
    relationships: s.relationships.map((r) => ({ name: r.name, targets: [...r.targets], cardinality: r.cardinality, inverse: r.inverse })),
  };
}

function provenanceOf(repo: Repository, e: Entity, opts: ToElementOptions): Provenance {
  const out: Provenance = {};
  const conforms = repo.resolve(e.id)?.attrs.get("conforms");
  if (typeof conforms === "string") out.conforms = conforms;
  const home = opts.homeOf?.(e.id);
  if (home !== undefined) out.home = home;
  return out;
}

// Incoming edges: who references e, and via which member. Root-only.
function incomingRefs(e: Entity): IncomingRef[] {
  const out: IncomingRef[] = [];
  for (const r of e.referrers())
    for (const rel of r.schema().relationships)
      if (r.refs(rel.name).some((t) => t.id === e.id))
        out.push({ id: r.id, concept: r.concept, via: rel.name });
  return out;
}
