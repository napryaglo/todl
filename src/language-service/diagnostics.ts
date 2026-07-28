import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-types";
import { Severity, type Diagnostic as TodlDiagnostic } from "../diagnostics/diagnostic.js";
import { spanToRange } from "./position.js";

const SEVERITY: Record<Severity, DiagnosticSeverity> = {
  [Severity.Error]:   DiagnosticSeverity.Error,
  [Severity.Warning]: DiagnosticSeverity.Warning,
};

// A whole-model (null-span) diagnostic collapses to the document start, matching
// the current in-renderer behavior.
const DOC_START = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

export function mapDiagnostic(d: TodlDiagnostic): Diagnostic {
  return {
    severity: SEVERITY[d.severity] ?? DiagnosticSeverity.Error,
    message: d.message,
    code: d.code,
    source: "todl",
    range: d.span === null ? DOC_START : spanToRange(d.span),
  };
}

export function mapDiagnostics(ds: readonly TodlDiagnostic[]): Diagnostic[] {
  return ds.map(mapDiagnostic);
}
