import { SymbolKind as LspSymbolKind, type WorkspaceSymbol } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { SymbolKind } from "./symbols.js";

const TO_LSP: Record<SymbolKind, LspSymbolKind> = {
  [SymbolKind.Concept]: LspSymbolKind.Class,
  [SymbolKind.Primitive]: LspSymbolKind.Struct,
  [SymbolKind.Taxonomy]: LspSymbolKind.Enum,
  [SymbolKind.Term]: LspSymbolKind.EnumMember,
  [SymbolKind.Instance]: LspSymbolKind.Object,
  [SymbolKind.Field]: LspSymbolKind.Field,
  [SymbolKind.Relationship]: LspSymbolKind.Method,
  [SymbolKind.Unknown]: LspSymbolKind.Null,
};

export function workspaceSymbols(a: Analysis, query: string): WorkspaceSymbol[] {
  const needle = query.toLowerCase();
  const out: WorkspaceSymbol[] = [];
  for (const def of a.defs.all()) {
    if (needle !== "" && !def.symbol.toLowerCase().includes(needle)) continue;
    out.push({
      name: def.symbol,
      kind: TO_LSP[def.kind],
      location: { uri: def.uri, range: def.nameRange },
    });
  }
  return out;
}
