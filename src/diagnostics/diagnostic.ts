import type { NodeId } from "../model/graph.js";
import type { SourceSpan } from "./span.js";

export enum Severity {
  Error = "error",
  Warning = "warning",
}

export enum DiagnosticCode {
  // Lex / parse (syntax) phase.
  UnexpectedCharacter = "syntax.unexpected-character",
  UnterminatedString = "syntax.unterminated-string",
  UnexpectedToken = "syntax.unexpected-token",
  ExpectedToken = "syntax.expected",
  // Semantic phase (unchanged values).
  RequiredMissing = "cardinality.required-missing",
  TooMany = "cardinality.too-many",
  EmptyNotAllowed = "cardinality.empty-not-allowed",
  TargetTypeMismatch = "relationship.target-type",
  InvariantFailed = "invariant.failed",
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  /** Source location; `null` only for genuine whole-model diagnostics. */
  span: SourceSpan | null;
  /** Semantic phase: the offending node; `null` for syntax diagnostics. */
  node: NodeId | null;
  /** Semantic phase: concept-qualified member path (`component.label`); else `null`. */
  path: string | null;
}
