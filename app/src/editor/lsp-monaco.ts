import * as monaco from "monaco-editor";

// LSP positions are 0-based (line/character); Monaco is 1-based (lineNumber/column).
export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface LspDiagnostic { range: LspRange; message: string; severity?: number; code?: string | number; source?: string }

export function toLspPosition(p: monaco.Position): LspPosition {
  return { line: p.lineNumber - 1, character: p.column - 1 };
}

export function toMonacoRange(r: LspRange): monaco.IRange {
  return { startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 };
}

// LSP DiagnosticSeverity: 1 Error, 2 Warning, 3 Information, 4 Hint.
function toMarkerSeverity(s?: number): monaco.MarkerSeverity {
  switch (s) {
    case 1: return monaco.MarkerSeverity.Error;
    case 2: return monaco.MarkerSeverity.Warning;
    case 3: return monaco.MarkerSeverity.Info;
    default: return monaco.MarkerSeverity.Hint;
  }
}

export function toMarker(d: LspDiagnostic): monaco.editor.IMarkerData {
  const r = toMonacoRange(d.range);
  return {
    severity: toMarkerSeverity(d.severity),
    message: d.message,
    code: d.code === undefined ? undefined : String(d.code),
    source: d.source ?? "todl",
    startLineNumber: r.startLineNumber, startColumn: r.startColumn,
    endLineNumber: r.endLineNumber, endColumn: r.endColumn,
  };
}
