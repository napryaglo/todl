import { MarkupKind, type Hover, type Position } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { classifyPosition, ContextKind } from "./classifier.js";
import { SymbolKind, symbolKindOf } from "./symbols.js";

const KIND_LABEL: Record<SymbolKind, string> = {
  [SymbolKind.Concept]: "concept", [SymbolKind.Primitive]: "primitive",
  [SymbolKind.Taxonomy]: "taxonomy", [SymbolKind.Term]: "term",
  [SymbolKind.Instance]: "instance", [SymbolKind.Field]: "field",
  [SymbolKind.Relationship]: "relationship", [SymbolKind.Unknown]: "symbol",
};

export function hoverAt(a: Analysis, uri: string, pos: Position): Hover | null {
  const ctx = classifyPosition(a, uri, pos);
  if (ctx.kind !== ContextKind.Identifier || ctx.symbol === undefined) return null;
  const symbol = ctx.symbol;
  const kind = symbolKindOf(a.model, symbol);
  const lines = ["```todl", `${KIND_LABEL[kind]} ${symbol}`, "```"];

  if (kind === SymbolKind.Concept) {
    const schema = a.model.schemaOf(symbol);
    if (schema.extends !== null) lines.push(`extends \`${schema.extends}\``);
    for (const f of schema.fields) lines.push(`- \`${f.name}\`: ${f.type}`);
    for (const r of schema.relationships) lines.push(`- \`${r.name}\` → ${r.target}`);
  }
  const node = a.model.resolve(symbol);
  const description = node?.attrs.get("description");
  if (typeof description === "string" && description.length > 0) lines.push("", description);

  return { contents: { kind: MarkupKind.Markdown, value: lines.join("\n") } };
}
