import type { SemanticTokens, SemanticTokensLegend, Range } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { Role } from "./reference-index.js";
import { SymbolKind } from "./symbols.js";

// The token-type legend, ordered — the encoded `tokenType` field indexes this.
const TYPES = ["type", "class", "enumMember", "property", "method", "variable"] as const;
export const SEMANTIC_LEGEND: SemanticTokensLegend = { tokenTypes: [...TYPES], tokenModifiers: [] };
const TYPE_INDEX: Record<(typeof TYPES)[number], number> = { type: 0, class: 1, enumMember: 2, property: 3, method: 4, variable: 5 };

// A reference role → token type. Concepts are 'type'; targets are concepts too.
const ROLE_TYPE: Record<Role, (typeof TYPES)[number]> = {
  [Role.Extends]: "type", [Role.FieldType]: "type", [Role.RelationshipTarget]: "type",
  [Role.InstanceConcept]: "type", [Role.InstanceOf]: "type", [Role.Represents]: "type",
  [Role.RefValue]: "variable", [Role.Import]: "class",
};

// A definition kind → token type.
function defType(kind: SymbolKind): (typeof TYPES)[number] {
  switch (kind) {
    case SymbolKind.Concept: return "type";
    case SymbolKind.Primitive: case SymbolKind.Taxonomy: return "class";
    case SymbolKind.Term: return "enumMember";
    case SymbolKind.Field: return "property";
    case SymbolKind.Relationship: return "method";
    default: return "variable";
  }
}

interface Raw { line: number; char: number; len: number; type: number }

export function semanticTokens(a: Analysis, uri: string): SemanticTokens {
  const raws: Raw[] = [];
  for (const occ of a.refs.all()) {
    if (occ.uri !== uri || occ.symbol === "") continue;
    raws.push(toRaw(occ.range, TYPE_INDEX[ROLE_TYPE[occ.role]]));
  }
  for (const def of a.defs.all()) {
    if (def.uri !== uri) continue;
    raws.push(toRaw(def.nameRange, TYPE_INDEX[defType(def.kind)]));
  }
  raws.sort((x, y) => (x.line - y.line) || (x.char - y.char));

  const data: number[] = [];
  let prevLine = 0, prevChar = 0;
  for (const r of raws) {
    const dLine = r.line - prevLine;
    const dChar = dLine === 0 ? r.char - prevChar : r.char;
    data.push(dLine, dChar, r.len, r.type, 0);
    prevLine = r.line; prevChar = r.char;
  }
  return { data };
}

function toRaw(range: Range, type: number): Raw {
  return { line: range.start.line, char: range.start.character, len: range.end.character - range.start.character, type };
}
