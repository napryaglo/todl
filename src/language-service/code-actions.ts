import {
  CodeActionKind, type CodeAction, type Diagnostic, type Range, type Position, type TextEdit,
} from "vscode-languageserver-types";
import { DiagnosticCode } from "../diagnostics/diagnostic.js";
import { TokenKind } from "../parse/lexer.js";
import { DeclKind, type Declaration, type InstanceDecl } from "../parse/ast.js";
import type { Analysis } from "./analysis.js";

export function codeActions(a: Analysis, uri: string, _range: Range, diagnostics: Diagnostic[]): CodeAction[] {
  const actions: CodeAction[] = [];
  for (const diag of diagnostics) {
    if (diag.code !== DiagnosticCode.RequiredMissing) continue;
    const action = addMissingField(a, uri, diag);
    if (action !== null) actions.push(action);
  }
  return actions;
}

// The diagnostic's range starts on the offending instance; insert `\n  <field> = ;`
// just after that instance's opening brace.
function addMissingField(a: Analysis, uri: string, diag: Diagnostic): CodeAction | null {
  const field = messageField(diag);
  if (field === "") return null;
  const at = openBracePosition(a, uri, diag.range.start);
  if (at === null) return null;
  const edit: TextEdit = { range: { start: at, end: at }, newText: `\n  ${field} = ;` };
  return {
    title: `Add missing field "${field}"`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diag],
    edit: { changes: { [uri]: [edit] } },
  };
}

// The field name from a required-missing diagnostic, parsed from its message tail
// `required "<concept>.<field>" is missing on …`.
function messageField(diag: Diagnostic): string {
  const m = /required\s+"[^".]+\.([^"]+)"/.exec(diag.message);
  return m?.[1] ?? "";
}

// The 0-based position just after the opening `{` of the instance whose record
// starts at `start` (the diagnostic's range start, on the instance line).
function openBracePosition(a: Analysis, uri: string, start: Position): Position | null {
  const file = a.sources.get(uri);
  if (file === undefined) return null;
  const inst = instanceAtLine(file.ast.declarations, start.line + 1);
  if (inst === null) return null;
  for (const t of file.tokens) {
    const afterStart = t.line > inst.span.start.line || (t.line === inst.span.start.line && t.column >= inst.span.start.column);
    if (afterStart && t.kind === TokenKind.LBrace) {
      return { line: t.endLine - 1, character: t.endColumn - 1 };
    }
  }
  return null;
}

function instanceAtLine(decls: Declaration[], line1: number): InstanceDecl | null {
  for (const decl of decls) {
    if (decl.kind !== DeclKind.Instance) continue;
    if (decl.span.start.line === line1) return decl;
    const nested = instanceAtLine(decl.children, line1);
    if (nested !== null) return nested;
  }
  return null;
}
