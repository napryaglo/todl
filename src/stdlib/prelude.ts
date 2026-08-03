import { readFileSync } from "node:fs";

import { load } from "../parse/loader.js";
import { Severity } from "../diagnostics/diagnostic.js";
import { toJSON, type TodlDocument } from "../emit/json.js";

export const PRELUDE_NAMESPACE = "todl";

// Resolves to src/stdlib/prelude.todl under tsx (dev) and dist/stdlib/prelude.todl
// when packaged (the build copies the .todl beside the compiled module).
const PRELUDE_URL = new URL("./prelude.todl", import.meta.url);

let cached: TodlDocument | undefined;
let cachedNames: ReadonlySet<string> | undefined;

/** The compiled prelude as a base document, memoized. Compiled with the RAW
 *  loader (never `check`) so it does not reference itself. Throws if the
 *  prelude itself is malformed — a build/authoring error, not a user one. */
export function preludeDocument(): TodlDocument {
  if (cached !== undefined) return cached;
  const text = readFileSync(PRELUDE_URL, "utf8");
  const { model, diagnostics } = load([{ uri: "todl:prelude", text }]);
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
