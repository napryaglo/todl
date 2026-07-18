import { load } from "./parse/loader.js";
import { validate } from "./validate/validate.js";
import type { SourceFile } from "./diagnostics/span.js";
import type { Diagnostic } from "./diagnostics/diagnostic.js";
import type { Model } from "./model/model.js";

/** Load the sources and validate the result; every diagnostic is spanned. */
export function check(sources: SourceFile[]): { model: Model; diagnostics: Diagnostic[] } {
  const { model, diagnostics } = load(sources);
  return { model, diagnostics: [...diagnostics, ...validate(model)] };
}
