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

export interface LspHover { contents: unknown; range?: LspRange }
export interface LspCompletionItem { label: string; kind?: number; detail?: string; documentation?: unknown; insertText?: string; sortText?: string }

/** Flatten an LSP hover `contents` (string | MarkupContent | MarkedString | array) to markdown. */
export function hoverMarkdown(h: LspHover): string {
  const one = (c: unknown): string =>
    typeof c === "string" ? c
    : c && typeof c === "object" && "value" in (c as Record<string, unknown>) ? String((c as { value: unknown }).value)
    : "";
  return Array.isArray(h.contents) ? h.contents.map(one).filter(Boolean).join("\n\n") : one(h.contents);
}

// LSP CompletionItemKind → Monaco CompletionItemKind (best-effort; both are ~parallel enums).
export function toMonacoCompletion(it: LspCompletionItem, range: monaco.IRange): monaco.languages.CompletionItem {
  return {
    label: it.label,
    kind: (it.kind ?? 1) as unknown as monaco.languages.CompletionItemKind,
    detail: it.detail,
    insertText: it.insertText ?? it.label,
    sortText: it.sortText,
    range,
  };
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
