/**
 * Namespace-scoped symbol resolver (design: unified-reference-resolver).
 *
 * The single name→node resolution law for the language. Node ids are flat and
 * globally unique; a namespace is a VISIBILITY gate: a reference resolves iff
 * the target's namespace is the reference's own namespace, one of its file's
 * imports, or global (prelude / namespace-less). A qualified `ns.x` resolves
 * the flat node `x` when its namespace is `ns` — explicit, so it needs no
 * import. Used by the loader (every reference) and validate.ts (bindings +
 * constructor scope) so namespace reachability lives in exactly one place.
 */
import type { Repository } from "../model/model.js";

// The foundational scalar TYPE keywords (`Scalar = string | number | boolean`).
// They are valid field/param types but are NOT declared nodes, so the resolver
// treats them as always-existing + global (reachable everywhere, never
// rewritten) — a qualified `ns.Concept` field type still gates normally.
const BUILTIN_TYPES: ReadonlySet<string> = new Set(["string", "number", "integer", "boolean"]);

/** A reference's home: the namespace of the file it sits in + that file's
 * imports. A target is reachable iff its namespace is this ns, one of the
 * imports, or global (prelude / namespace-less). */
export interface Home {
  ns: string;
  imports: readonly string[];
}

export type Resolved =
  | { kind: "ok" }
  | { kind: "qualified"; flat: string }
  | { kind: "unreachable"; ns: string }
  | { kind: "undefined" };

export interface Resolver {
  /** The namespace a flat id belongs to, or null for prelude / namespace-less. */
  nsOf(id: string): string | null;
  /** True if `id` is a source-defined or base node. */
  exists(id: string): boolean;
  /** True if a node with flat id `id` is reachable from `home`. */
  reachable(id: string, home: Home): boolean;
  /** Resolve a reference name (bare or qualified) from `home`. */
  resolveRef(name: string, home: Home): Resolved;
}

export function makeResolver(
  model: Repository,
  defined: ReadonlySet<string>,
  sourceNs: ReadonlyMap<string, string>,
  reserved: ReadonlySet<string>,
): Resolver {
  const nsOf = (id: string): string | null => {
    if (sourceNs.has(id)) return sourceNs.get(id)!;
    const attr = model.resolve(id)?.attrs.get("namespace");
    return typeof attr === "string" ? attr : null;
  };
  const exists = (id: string): boolean => defined.has(id) || model.has(id) || BUILTIN_TYPES.has(id);
  const reachable = (id: string, home: Home): boolean => {
    // Prelude / default-library symbols (its namespace is `todl`) are
    // implicitly imported everywhere, like java.lang — `reserved` is exactly
    // the prelude's declared names, injected by check()/checkAgainst().
    if (reserved.has(id)) return true;
    const ns = nsOf(id);
    return ns === null || ns === home.ns || home.imports.includes(ns);
  };
  const resolveRef = (id: string, home: Home): Resolved => {
    if (exists(id)) return reachable(id, home) ? { kind: "ok" } : { kind: "unreachable", ns: nsOf(id)! };
    // Strip leading namespace segment(s): `ea.categories` → flat `categories`
    // in ns `ea`; `ns.tax.term` → flat `tax.term` in ns `ns`. Flat-id match
    // (above) wins first, so `categories.platform-api` stays the term node.
    const segs = id.split(".");
    for (let k = 1; k < segs.length; k++) {
      const rest = segs.slice(k).join(".");
      if (exists(rest) && nsOf(rest) === segs.slice(0, k).join(".")) return { kind: "qualified", flat: rest };
    }
    return { kind: "undefined" };
  };
  return { nsOf, exists, reachable, resolveRef };
}
