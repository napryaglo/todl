import { load } from "../parse/loader.js";
import { Severity } from "../diagnostics/diagnostic.js";
import { toJSON, type TodlDocument } from "../emit/json.js";
import { PRELUDE_SOURCE } from "./prelude.generated.js";

export const PRELUDE_NAMESPACE = "todl";

let cached: TodlDocument | undefined;
let cachedNames: ReadonlySet<string> | undefined;

/** The compiled prelude as a base document, memoized. Compiled with the RAW
 *  loader (never `check`) so it does not reference itself. The source is
 *  embedded (generated from prelude.todl) so it survives bundling to a single
 *  file, where import.meta.url / sibling-file reads break. Throws if the
 *  prelude itself is malformed — a build/authoring error, not a user one. */
export function preludeDocument(): TodlDocument {
  if (cached !== undefined) return cached;
  const { model, diagnostics } = load([{ uri: "todl:prelude", text: PRELUDE_SOURCE }]);
  const errors = diagnostics.filter((d) => d.severity === Severity.Error);
  if (errors.length > 0) {
    throw new Error(`TODL prelude failed to compile: ${errors.map((d) => d.message).join("; ")}`);
  }
  cached = toJSON(model);
  return cached;
}

/** The bare ids the prelude defines — used to flag user redeclarations. */
export function preludeNames(): ReadonlySet<string> {
  if (cachedNames !== undefined) return cachedNames;
  cachedNames = new Set(preludeDocument().nodes.map((n) => n.id));
  return cachedNames;
}
