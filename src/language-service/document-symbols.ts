import { SymbolKind, type DocumentSymbol, type Range } from "vscode-languageserver-types";
import type { SourceSpan } from "../diagnostics/span.js";
import type { Analysis } from "./analysis.js";
import { spanToRange } from "./position.js";
import {
  DeclKind, type Declaration, type ConceptDecl, type InstanceDecl,
} from "../parse/ast.js";

export function documentSymbols(a: Analysis, uri: string): DocumentSymbol[] {
  const ast = a.sources.get(uri)?.ast;
  if (ast === undefined) return [];
  return ast.declarations.map((d) => toSymbol(d)).filter((s): s is DocumentSymbol => s !== null);
}

function toSymbol(decl: Declaration): DocumentSymbol | null {
  const range = spanToRange(decl.span);
  switch (decl.kind) {
    case DeclKind.Primitive:
      return leaf(decl.name, SymbolKind.Struct, range, nameRange(decl.nameSpan, range));
    case DeclKind.Taxonomy:
      return leaf(decl.name, SymbolKind.Enum, range, nameRange(decl.nameSpan, range));
    case DeclKind.Concept:
      return conceptSymbol(decl, range);
    case DeclKind.Instance:
      return instanceSymbol(decl, range);
  }
}

function conceptSymbol(decl: ConceptDecl, range: Range): DocumentSymbol {
  const children: DocumentSymbol[] = [];
  for (const f of decl.fields) {
    if (f.nameSpan !== undefined) children.push(leaf(f.name, SymbolKind.Field, spanToRange(f.nameSpan), spanToRange(f.nameSpan)));
  }
  for (const r of decl.relationships) {
    if (r.nameSpan !== undefined) children.push(leaf(r.name, SymbolKind.Method, spanToRange(r.nameSpan), spanToRange(r.nameSpan)));
  }
  const sym = leaf(decl.name, SymbolKind.Class, range, nameRange(decl.nameSpan, range));
  if (children.length > 0) sym.children = children;
  return sym;
}

function instanceSymbol(decl: InstanceDecl, range: Range): DocumentSymbol {
  const children = decl.children.map((c) => instanceSymbol(c, spanToRange(c.span)));
  const sym = leaf(decl.id, SymbolKind.Object, range, nameRange(decl.idSpan, range));
  if (children.length > 0) sym.children = children;
  return sym;
}

function leaf(name: string, kind: SymbolKind, range: Range, selectionRange: Range): DocumentSymbol {
  return { name, kind, range, selectionRange };
}

function nameRange(span: SourceSpan | undefined, fallback: Range): Range {
  return span === undefined ? fallback : spanToRange(span);
}
