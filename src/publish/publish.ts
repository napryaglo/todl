/**
 * The publish capability: compile sources against bases, gate on errors, derive
 * package metadata, and — via a PackageStore — persist. Compute (`compilePackage`)
 * is pure and I/O-free; persistence flows through an injected store.
 *
 * The persisted `model.json` is OWN-only: it carries only the nodes this package
 * added beyond the seeded base graph (prelude + bases), plus a `dependencies`
 * list naming the bases it was compiled against. Consumers reassemble the closure
 * by resolving those dependencies transitively. `fullDocument` (the closure) is
 * retained on the outcome for presentation / annotation baking.
 */

import { checkAgainst } from "../api.js";
import { toJSON, toJSONOwn, type TodlDocument } from "../emit/json.js";
import { Severity, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/span.js";
import { preludeDocument } from "../stdlib/prelude.js";
import { deriveClasses, type PublishedClass } from "./reflect.js";
import type { PackageStore } from "./stores.js";

/** The kind of package a dependency points at (which backend resolves it). */
export enum PackageKind {
  MetaModel = "meta-model",
  Library = "library",
}

/** A pinned reference to a base package this one was compiled against. */
export interface PackageRef {
  kind: PackageKind;
  id: string;
  version: string;
}

export interface PackageIdentity {
  id: string;
  version: string;
  name?: string;
}

/** The persisted model.json shape: a TodlDocument plus recorded base deps. The
 *  extra field is ignored by graphFromJSON and the `bases: TodlDocument[]` input
 *  path, so the base-input contract is unchanged (a superset of TodlDocument). */
export interface PackageDocument extends TodlDocument {
  dependencies?: PackageRef[];
}

export interface CompiledPackage extends PackageIdentity {
  document: PackageDocument;         // own-only + dependencies — persisted as model.json
  fullDocument: TodlDocument;        // the full compiled closure — for presentation/annotation baking
  sources: readonly SourceFile[];    // raw .todl passthrough (persisted under src/)
  classes: readonly PublishedClass[]; // instantiable palette classes (own-only)
}

export interface CompileOutcome {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[]; // diagnostics filtered to Severity.Error
  package?: CompiledPackage; // present iff ok
}

export interface PublishOutcome extends CompileOutcome {
  persisted: boolean;
}

/**
 * Compile sources against bases, gate on errors, and — if clean — build a
 * self-describing CompiledPackage. Pure; no I/O. A failing compile returns no
 * `package`, so callers cannot accidentally persist it.
 *
 * `dependencies` names the base packages the caller resolved into `bases` (by
 * pinned id + version); it is recorded on the own-only `document` for transitive
 * resolution by consumers.
 */
export function compilePackage(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  identity: PackageIdentity,
  dependencies?: readonly PackageRef[],
): CompileOutcome {
  const { model, diagnostics } = checkAgainst([...bases], [...sources]);
  const errors = diagnostics.filter((d) => d.severity === Severity.Error);
  if (errors.length > 0) return { ok: false, diagnostics, errors };

  // Own = every node the compile added beyond the seeded base graph. The seed is
  // `mergeBases([prelude, ...bases])`, so its ids are the union of the prelude
  // document and every base document. (`provenance` only homes instance/model
  // declarations, not taxonomies/concepts/annotations — so it is NOT the
  // own-set.)
  const baseIds = new Set<string>();
  for (const b of [preludeDocument(), ...bases]) for (const n of b.nodes) baseIds.add(n.id);
  const ownIds = new Set(model.allNodes().map((n) => n.id).filter((id) => !baseIds.has(id)));

  const fullDocument = toJSON(model);
  const document: PackageDocument = toJSONOwn(model, ownIds);
  if (dependencies !== undefined && dependencies.length > 0) {
    document.dependencies = [...dependencies];
  }

  const pkg: CompiledPackage = {
    ...identity,
    document,
    fullDocument,
    sources,
    classes: deriveClasses(document, fullDocument),
  };
  return { ok: true, diagnostics, errors, package: pkg };
}

/** Compile, and — only if clean — persist the package through the store. */
export async function publish(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  store: PackageStore,
  identity: PackageIdentity,
  dependencies?: readonly PackageRef[],
): Promise<PublishOutcome> {
  const outcome = compilePackage(bases, sources, identity, dependencies);
  if (!outcome.ok || outcome.package === undefined) return { ...outcome, persisted: false };
  await store.persist(outcome.package);
  return { ...outcome, persisted: true };
}
