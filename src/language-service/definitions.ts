import type { Range, Position } from "vscode-languageserver-types";
import type { SourceSpan } from "../diagnostics/span.js";
import {
  DeclKind, type NamespaceNode, type Declaration, type InstanceDecl, type Term,
} from "../parse/ast.js";
import { spanToRange } from "./position.js";
import { SymbolKind } from "./symbols.js";

export interface Definition { symbol: string; uri: string; nameRange: Range; kind: SymbolKind }

export interface DefinitionIndex {
  get(symbol: string): Definition | null;
  definitionAt(uri: string, pos: Position): Definition | null;
  all(): Definition[];
}

type Add = (uri: string, symbol: string, span: SourceSpan | undefined, kind: SymbolKind) => void;

export function buildDefinitionIndex(files: Map<string, NamespaceNode>): DefinitionIndex {
  const defs: Definition[] = [];
  const add: Add = (uri, symbol, span, kind) => {
    if (span === undefined) return;
    defs.push({ symbol, uri, kind, nameRange: spanToRange(span) });
  };

  for (const [uri, ns] of files) {
    for (const decl of ns.declarations) addDecl(uri, decl, add);
  }

  const bySymbol = new Map<string, Definition>();
  for (const d of defs) if (!bySymbol.has(d.symbol)) bySymbol.set(d.symbol, d);

  return {
    all: () => defs,
    get: (symbol) => bySymbol.get(symbol) ?? null,
    definitionAt: (uri, pos) => defs.find((d) => d.uri === uri && contains(d.nameRange, pos)) ?? null,
  };
}

function addDecl(uri: string, decl: Declaration, add: Add): void {
  switch (decl.kind) {
    case DeclKind.Primitive: add(uri, decl.name, decl.nameSpan, SymbolKind.Primitive); break;
    case DeclKind.Concept:   add(uri, decl.name, decl.nameSpan, SymbolKind.Concept); break;
    case DeclKind.Taxonomy:
      add(uri, decl.name, decl.nameSpan, SymbolKind.Taxonomy);
      for (const term of decl.terms) addTerm(uri, term, add);
      break;
    case DeclKind.Instance:  addInstance(uri, decl, add); break;
  }
}

function addInstance(uri: string, inst: InstanceDecl, add: Add): void {
  add(uri, inst.id, inst.idSpan, inst.isClass ? SymbolKind.Term : SymbolKind.Instance);
  for (const child of inst.children) addInstance(uri, child, add);
}

function addTerm(uri: string, term: Term, add: Add): void {
  // Terms are keyed by bare id — how they are referenced from instances.
  add(uri, term.id, term.idSpan, SymbolKind.Term);
  for (const child of term.children) addTerm(uri, child, add);
}

function contains(range: Range, pos: Position): boolean {
  const afterStart = pos.line > range.start.line ||
    (pos.line === range.start.line && pos.character >= range.start.character);
  const beforeEnd = pos.line < range.end.line ||
    (pos.line === range.end.line && pos.character < range.end.character);
  return afterStart && beforeEnd;
}
