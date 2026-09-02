import { check, type TodlDocument } from "@pragmatic-tech-ai/todl";
import type { ExampleSource, GoldenDiagnostic } from "./corpus-types.js";
import { DeterministicIdGenerator, normalize, selectOwnDocument } from "./verify.js";

export interface DisplayResult {
  diagnostics: GoldenDiagnostic[];
  document: TodlDocument;
  ok: boolean;
}

export interface DisplayOptions {
  /** Attach readable debug metadata (kind/name/type/namespace/source, edge
   *  endpoints) to each emitted node/edge — survives id canonicalization. */
  debug?: boolean;
}

/** Compile editor text for on-screen display: canonicalized diagnostics + the
 *  own-nodes document (concepts, taxonomies, terms, models, instances — the same
 *  selection goldens use). Pure — no golden comparison, no filesystem. */
export function compileForDisplay(sources: ExampleSource[], options?: DisplayOptions): DisplayResult {
  const idGen = new DeterministicIdGenerator();
  const { model, diagnostics, provenance } = check(sources.map((s) => ({ uri: s.name, text: s.text })), idGen);
  const emit = options?.debug ? { debug: true, provenance } : undefined;
  const golden = normalize({ document: selectOwnDocument(model, [], emit), diagnostics });
  return {
    diagnostics: golden.diagnostics,
    document: golden.document,
    ok: golden.diagnostics.every((d) => d.severity !== "error"),
  };
}
