import type { Location, Position } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { classifyPosition, ContextKind } from "./classifier.js";
import { spanToRange } from "./position.js";

// Resolve the symbol under the cursor (a reference occurrence classifies as
// Identifier and carries its symbol id).
function symbolAt(a: Analysis, uri: string, pos: Position): string | null {
  const ctx = classifyPosition(a, uri, pos);
  return ctx.kind === ContextKind.Identifier && ctx.symbol !== undefined ? ctx.symbol : null;
}

export function definitionAt(a: Analysis, uri: string, pos: Position): Location | null {
  const symbol = symbolAt(a, uri, pos);
  if (symbol === null) return null;
  const span = a.model.spanOf(symbol);   // null for base symbols with no source span (boundary)
  if (span === null) return null;
  return { uri: span.uri, range: spanToRange(span) };
}

export function referencesAt(a: Analysis, uri: string, pos: Position, includeDecl: boolean): Location[] {
  const symbol = symbolAt(a, uri, pos);
  if (symbol === null) return [];
  const locations: Location[] = a.refs.get(symbol).map((o) => ({ uri: o.uri, range: o.range }));
  if (includeDecl) {
    const span = a.model.spanOf(symbol);
    if (span !== null) locations.unshift({ uri: span.uri, range: spanToRange(span) });
  }
  return locations;
}
