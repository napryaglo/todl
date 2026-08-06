/**
 * The publish capability: compile sources against bases, gate on errors, derive
 * package metadata, and — via a PackageStore — persist. Compute (`compilePackage`)
 * is pure and I/O-free; persistence flows through an injected store.
 */

import { checkAgainst } from "../api.js";
import { toJSON, type TodlDocument } from "../emit/json.js";
import { Severity, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/span.js";
import { deriveClasses, type PublishedClass } from "./reflect.js";
import type { PackageStore } from "./stores.js";

export interface PackageIdentity {
  id: string;
  version: string;
  name?: string;
}

export interface CompiledPackage extends PackageIdentity {
  document: TodlDocument; // toJSON(compiled model) — the model.json
  sources: readonly SourceFile[]; // raw .todl passthrough (persisted under src/)
  classes: readonly PublishedClass[]; // instantiable palette classes
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
 */
export function compilePackage(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  identity: PackageIdentity,
): CompileOutcome {
  const { model, diagnostics } = checkAgainst([...bases], [...sources]);
  const errors = diagnostics.filter((d) => d.severity === Severity.Error);
  if (errors.length > 0) return { ok: false, diagnostics, errors };
  const document = toJSON(model);
  const pkg: CompiledPackage = {
    ...identity,
    document,
    sources,
    classes: deriveClasses(document),
  };
  return { ok: true, diagnostics, errors, package: pkg };
}

/** Compile, and — only if clean — persist the package through the store. */
export async function publish(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  store: PackageStore,
  identity: PackageIdentity,
): Promise<PublishOutcome> {
  const outcome = compilePackage(bases, sources, identity);
  if (!outcome.ok || outcome.package === undefined) return { ...outcome, persisted: false };
  await store.persist(outcome.package);
  return { ...outcome, persisted: true };
}
