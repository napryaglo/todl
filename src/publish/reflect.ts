/**
 * Model/annotation reflection for publishing — relocated from Plexus
 * (`library-bundle.ts` deriveClasses + `annotation-projection.ts`). Pure
 * traversal over a compiled `TodlDocument`; no I/O.
 */

import type { TodlDocument } from "../emit/json.js";

const ANNOTATED = "Annotated";
const NAMESPACE_ATTR = "namespace";

/** One instantiable class a package provides — a palette item. */
export interface PublishedClass {
  id: string; // qualified class NodeId, e.g. "microsoft.azure"
  concept: string; // node.typeOf — the meta concept it realises, e.g. "location"
  localId?: string; // attrs.id — the bare local name
  label?: string; // attrs.label, if present
  icon?: string; // annotation-derived icon path (bundle-relative)
}

/**
 * Project a target node's annotations from a compiled document: walk the
 * `Annotated` edges out of `targetId` to its application nodes, key each by the
 * application's `typeOf` (the annotation name), value = the application's scalar
 * attrs with the `namespace` provenance stamp removed. No annotations → `{}`.
 */
export function projectAnnotations(model: TodlDocument, targetId: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const edge of model.edges) {
    if (edge.kind !== ANNOTATED || edge.from !== targetId) continue;
    const appNode = model.nodes.find((n) => n.id === edge.to);
    if (appNode === undefined) continue;
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(appNode.attrs as Record<string, unknown>)) {
      if (k === NAMESPACE_ATTR) continue;
      params[k] = v;
    }
    out[appNode.typeOf] = params;
  }
  return out;
}

/**
 * The instantiable classes a package provides: Instance-tier clabjects
 * (`attrs.class === true`), each an instance of a meta concept and a class for
 * further instantiation. `tier` compares to the "Instance" member-name string
 * because `toJSON` emits the Tier enum by name.
 */
export function deriveClasses(model: TodlDocument): PublishedClass[] {
  const out: PublishedClass[] = [];
  for (const n of model.nodes) {
    const attrs = n.attrs as Record<string, unknown>;
    if (n.tier !== "Instance" || attrs.class !== true) continue;
    const cls: PublishedClass = { id: n.id, concept: n.typeOf };
    if (typeof attrs.id === "string") cls.localId = attrs.id;
    if (typeof attrs.label === "string") cls.label = attrs.label;
    const iconAnn = projectAnnotations(model, n.id).icon;
    const iconPath = iconAnn === undefined ? undefined : iconAnn.path;
    if (typeof iconPath === "string") cls.icon = iconPath;
    out.push(cls);
  }
  return out;
}
