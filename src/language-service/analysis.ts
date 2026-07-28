import type { Diagnostic } from "vscode-languageserver-types";
import { parse } from "../parse/parser.js";
import { tokenize, type Token } from "../parse/lexer.js";
import { checkAgainst } from "../api.js";
import type { SourceFile } from "../diagnostics/span.js";
import type { TodlDocument } from "../emit/json.js";
import type { Repository } from "../model/model.js";
import type { NamespaceNode } from "../parse/ast.js";
import { buildReferenceIndex, type ReferenceIndex } from "./reference-index.js";
import { mapDiagnostics } from "./diagnostics.js";

// The whole-project analysis. Pure — recomputed from scratch by `analyze`; the
// core keeps no cache (the server owns caching).
export interface Analysis {
  sources: Map<string, { ast: NamespaceNode; tokens: Token[] }>;
  model: Repository;
  refs: ReferenceIndex;
  diagnostics: Diagnostic[];
}

export function analyze(sources: SourceFile[], bases: TodlDocument[] = []): Analysis {
  const parsed = new Map<string, { ast: NamespaceNode; tokens: Token[] }>();
  const asts = new Map<string, NamespaceNode>();
  for (const src of sources) {
    const ast = parse(src.text, src.uri).namespace;
    parsed.set(src.uri, { ast, tokens: tokenize(src.text) });
    asts.set(src.uri, ast);
  }
  const { model, diagnostics } = checkAgainst(bases, sources);
  return {
    sources: parsed,
    model,
    refs: buildReferenceIndex(asts),
    diagnostics: mapDiagnostics(diagnostics),
  };
}
