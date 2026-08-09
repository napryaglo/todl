/**
 * Emit a model's OWN delta as round-trippable `.todl` source (design: model
 * emitter + file store). Type-directed (todl ≥ 0.14): reference values are bare
 * or dotted names (no sigil); instance own id/concept/instanceof use the local
 * name, reference targets keep their full id. Ported from Plexus `todl-emitter.ts`.
 */

import { MetaKind } from "../model/kinds.js";
import { type NodeId, type Scalar } from "../model/graph.js";
import { Repository } from "../model/model.js";
import { type TodlDocument, type JsonNode } from "./json.js";

/** The default-library (prelude) namespace — a base, never a project binding. */
const PRELUDE_NAMESPACE = "todl";
/** Attrs that are markers, not authored fields. */
const MARKER_ATTRS = new Set(["id", "class", "namespace", "conforms"]);

export interface ModelBindings {
  metaModel: string;
  uses: string[];
  imports: string[];
}

/** Derive a model's bindings from the combined model + base-id set + own delta. */
export function deriveBindings(
  model: Repository,
  baseIds: ReadonlySet<NodeId>,
  namespace: string,
  own: TodlDocument,
): ModelBindings {
  const baseNs = new Set<string>();
  const taxIds = new Set<string>();
  for (const node of model.allNodes()) {
    if (!baseIds.has(node.id)) continue;
    const ns = node.attrs.get("namespace");
    if (typeof ns === "string" && ns.length > 0 && ns !== PRELUDE_NAMESPACE) baseNs.add(ns);
    if (node.typeOf === MetaKind.Taxonomy) taxIds.add(node.id);
  }
  const taxonomyOf = (id: string): string | undefined => {
    const dot = id.indexOf(".");
    if (dot < 0) return undefined;
    const tax = id.slice(0, dot);
    return taxIds.has(tax) ? tax : undefined;
  };
  const usesSet = new Set<string>();
  for (const edge of own.edges) {
    const tax = taxonomyOf(String(edge.to));
    if (tax !== undefined) usesSet.add(tax);
  }
  const sortedBase = [...baseNs].sort();
  const metaModel = sortedBase[0] ?? namespace;
  const imports = sortedBase.filter((n) => n !== namespace);
  return { metaModel, uses: [...usesSet].sort(), imports };
}

/** The local (un-dotted) name of an id — for the instance's own id/concept/class. */
function localName(id: string): string {
  const i = id.lastIndexOf(".");
  return i >= 0 ? id.slice(i + 1) : id;
}

function literal(v: Scalar): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

export function emitModelTodl(own: TodlDocument, namespace: string, bindings: ModelBindings, conforms?: string): string {
  const instances = own.nodes;
  const classes = instances.filter((n) => (n.attrs as Record<string, unknown>).class === true);
  const concrete = instances.filter((n) => (n.attrs as Record<string, unknown>).class !== true);

  const instanceOf = new Map<string, string>();
  const rels = new Map<string, Array<{ via: string; to: string }>>();
  for (const e of own.edges) {
    const from = String(e.from);
    if (e.kind === "InstanceOf") instanceOf.set(from, String(e.to));
    else if (e.kind === "Relationship" && e.via !== null) {
      const list = rels.get(from) ?? [];
      list.push({ via: String(e.via), to: String(e.to) });
      rels.set(from, list);
    }
  }

  const lines: string[] = [`namespace ${namespace}`, "{"];
  for (const ns of bindings.imports) lines.push(`  import ${ns};`);
  for (const n of classes) lines.push(...emitOne(n, instanceOf.get(n.id), rels.get(n.id) ?? []));
  if (concrete.length > 0) {
    const uses = bindings.uses.length > 0 ? ` uses ${bindings.uses.join(", ")}` : "";
    // The model id must be a bare C-like identifier (no dots); a dotted namespace
    // is flattened to camelCase so `acme.app` → `acmeAppModel`.
    const modelId = `${namespace.split(".").map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1))).join("")}Model`;
    const conf = conforms !== undefined ? ` conforms ${conforms}` : "";
    lines.push(`  model ${modelId} : ${bindings.metaModel}${uses}${conf} {`);
    for (const n of concrete) {
      for (const l of emitOne(n, instanceOf.get(n.id), rels.get(n.id) ?? [])) lines.push(`  ${l}`);
    }
    lines.push("  }");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function emitOne(node: JsonNode, cls: string | undefined, relEdges: Array<{ via: string; to: string }>): string[] {
  const concept = localName(node.typeOf);
  const isClass = (node.attrs as Record<string, unknown>).class === true;
  const head = isClass
    ? `class ${concept} ${localName(node.id)}`
    : cls !== undefined
      ? `${concept} ${localName(node.id)} instanceof ${localName(cls)}`
      : `${concept} ${localName(node.id)}`;

  const body: string[] = [];
  for (const [name, value] of Object.entries(node.attrs)) {
    if (MARKER_ATTRS.has(name)) continue;
    body.push(`${name} = ${literal(value as Scalar)};`);
  }
  const byMember = new Map<string, string[]>();
  for (const r of relEdges) {
    const list = byMember.get(r.via) ?? [];
    list.push(r.to);
    byMember.set(r.via, list);
  }
  for (const [member, targets] of byMember) {
    body.push(targets.length === 1 ? `${member} = ${targets[0]};` : `${member} = [${targets.join(", ")}];`);
  }

  if (body.length === 0) return [`  ${head} {}`];
  return [`  ${head} {`, ...body.map((b) => `    ${b}`), "  }"];
}
