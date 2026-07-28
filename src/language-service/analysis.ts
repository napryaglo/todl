import type { Diagnostic } from "vscode-languageserver-types";
import { parse } from "../parse/parser.js";
import { tokenize, type Token } from "../parse/lexer.js";
import { checkAgainst } from "../api.js";
import type { SourceFile } from "../diagnostics/span.js";
import type { TodlDocument } from "../emit/json.js";
import type { Repository } from "../model/model.js";
import type { NamespaceNode } from "../parse/ast.js";
import { buildReferenceIndex, type ReferenceIndex } from "./reference-index.js";
import { buildDefinitionIndex, type DefinitionIndex } from "./definitions.js";
import { mapDiagnostics, mapDiagnostic } from "./diagnostics.js";

// The whole-project analysis. Pure — recomputed from scratch by `analyze`; the
// core keeps no cache (the server owns caching).
export interface Analysis {
  sources: Map<string, { ast: NamespaceNode; tokens: Token[]; text: string }>;
  model: Repository;
  refs: ReferenceIndex;
  defs: DefinitionIndex;
  diagnostics: Diagnostic[];
  // Diagnostics grouped by file URI for per-document publishing. Every source
  // file has an entry (empty when clean, so a fixed file's squiggles clear);
  // whole-model (null-span) diagnostics attach to every file in the project.
  diagnosticsByUri: Map<string, Diagnostic[]>;
}

export function analyze(sources: SourceFile[], bases: TodlDocument[] = []): Analysis {
  const parsed = new Map<string, { ast: NamespaceNode; tokens: Token[]; text: string }>();
  const asts = new Map<string, NamespaceNode>();
  for (const src of sources) {
    const ast = parse(src.text, src.uri).namespace;
    parsed.set(src.uri, { ast, tokens: tokenize(src.text), text: src.text });
    asts.set(src.uri, ast);
  }
  const { model, diagnostics } = checkAgainst(bases, sources);

  const byUri = new Map<string, Diagnostic[]>();
  for (const src of sources) byUri.set(src.uri, []);
  const wholeModel: Diagnostic[] = [];
  for (const d of diagnostics) {
    const lsp = mapDiagnostic(d);
    const uri = d.span?.uri ?? null;
    if (uri === null) { wholeModel.push(lsp); continue; }
    const list = byUri.get(uri);
    if (list === undefined) byUri.set(uri, [lsp]);
    else list.push(lsp);
  }
  // Whole-model diagnostics (no file) surface on every file in the project.
  if (wholeModel.length > 0) for (const list of byUri.values()) list.push(...wholeModel);

  return {
    sources: parsed,
    model,
    refs: buildReferenceIndex(asts),
    defs: buildDefinitionIndex(asts),
    diagnostics: mapDiagnostics(diagnostics),
    diagnosticsByUri: byUri,
  };
}
