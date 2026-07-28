import type { Range, Position, WorkspaceEdit, TextEdit } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";

export interface RenameError { error: string }

const KEBAB = /^[a-z][a-z0-9-]*$/;

// Resolve the symbol under the cursor — a reference occurrence or a definition
// name — tolerating a cursor on the identifier's trailing edge.
function resolve(a: Analysis, uri: string, pos: Position): { symbol: string; range: Range } | null {
  const back = pos.character > 0 ? { line: pos.line, character: pos.character - 1 } : pos;
  const occ = a.refs.occurrenceAt(uri, pos) ?? a.refs.occurrenceAt(uri, back);
  if (occ !== null && occ.symbol !== "") return { symbol: occ.symbol, range: occ.range };
  const def = a.defs.definitionAt(uri, pos) ?? a.defs.definitionAt(uri, back);
  if (def !== null) return { symbol: def.symbol, range: def.nameRange };
  return null;
}

export function prepareRename(a: Analysis, uri: string, pos: Position): Range | null {
  return resolve(a, uri, pos)?.range ?? null;
}

export function renameEdits(a: Analysis, uri: string, pos: Position, newName: string): WorkspaceEdit | RenameError {
  const target = resolve(a, uri, pos);
  if (target === null) return { error: "Nothing to rename here." };
  if (!KEBAB.test(newName)) return { error: `"${newName}" is not a valid kebab-case name.` };
  if (a.model.has(newName)) return { error: `"${newName}" already exists.` };

  const symbol = target.symbol;
  const edits: { uri: string; edit: TextEdit }[] = [];
  const def = a.defs.get(symbol);
  if (def !== null) edits.push({ uri: def.uri, edit: { range: def.nameRange, newText: newName } });
  for (const occ of a.refs.get(symbol)) edits.push({ uri: occ.uri, edit: { range: occ.range, newText: newName } });

  const changes: Record<string, TextEdit[]> = {};
  for (const { uri: u, edit } of edits) (changes[u] ??= []).push(edit);
  return { changes };
}
