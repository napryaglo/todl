import type { Position } from "vscode-languageserver-types";
import { TokenKind, type Token } from "../parse/lexer.js";
import type { Analysis } from "./analysis.js";
import { positionToTodl } from "./position.js";

export interface AssignmentContext {
  concept: string;
  member: string;
  targetConcept: string | null;
  cardinality: number;
  isRelationship: boolean;
}

// Resolve the assignment slot at `pos`: the enclosing record's concept, the
// member name to its left (`<member> = …`), and that member's declared type or
// relationship target from the effective schema. Null when the cursor is not in
// an `<member> = <value>` position inside a record body.
//
// This works purely off the token stream (which `tokenize` produces regardless
// of parse errors), so it still resolves while the user is mid-typing an
// incomplete value like `owner = &` — exactly when completion fires.
export function assignmentContextAt(a: Analysis, uri: string, pos: Position): AssignmentContext | null {
  const file = a.sources.get(uri);
  if (file === undefined) return null;
  const tp = positionToTodl(pos);

  const member = memberBeforeCursor(file.tokens, tp);
  if (member === null) return null;
  const concept = enclosingConcept(file.tokens, tp);
  if (concept === null) return null;

  const schema = a.model.effectiveSchema(concept);
  const rel = schema.relationships.find((r) => r.name === member);
  if (rel !== undefined) {
    return { concept, member, targetConcept: rel.target, cardinality: rel.cardinality, isRelationship: true };
  }
  const field = schema.fields.find((f) => f.name === member);
  if (field !== undefined) {
    return { concept, member, targetConcept: field.type, cardinality: field.cardinality, isRelationship: false };
  }
  return { concept, member, targetConcept: null, cardinality: 0, isRelationship: false };
}

// Index of the first token starting at/after the cursor (else the end).
function cursorIndex(tokens: Token[], tp: { line: number; column: number }): number {
  const idx = tokens.findIndex((t) => t.line > tp.line || (t.line === tp.line && t.column >= tp.column));
  return idx === -1 ? tokens.length : idx;
}

// The concept of the record enclosing the cursor: brace-match backwards to the
// opening `{`, then take the leftmost identifier of the record header
// (`<concept> <id> [instanceof X] [: bind] {`).
function enclosingConcept(tokens: Token[], tp: { line: number; column: number }): string | null {
  const start = cursorIndex(tokens, tp);
  let depth = 0;
  let openIdx = -1;
  for (let i = start - 1; i >= 0; i -= 1) {
    const k = tokens[i]?.kind;
    if (k === TokenKind.RBrace) depth += 1;
    else if (k === TokenKind.LBrace) { if (depth === 0) { openIdx = i; break; } depth -= 1; }
  }
  if (openIdx < 0) return null;
  let concept: string | null = null;
  for (let i = openIdx - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t === undefined) continue;
    if (t.kind === TokenKind.Semicolon || t.kind === TokenKind.LBrace || t.kind === TokenKind.RBrace) break;
    if (t.kind === TokenKind.Identifier) concept = t.value;   // leftmost wins
  }
  return concept;
}

// Scan back from the cursor for the `<identifier> =` pattern; return the
// identifier — the member being assigned. Stops at a statement/block boundary.
function memberBeforeCursor(tokens: Token[], tp: { line: number; column: number }): string | null {
  const start = cursorIndex(tokens, tp);
  for (let i = start - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t === undefined) continue;
    if (t.kind === TokenKind.Equals) {
      const name = tokens[i - 1];
      return name !== undefined && name.kind === TokenKind.Identifier ? name.value : null;
    }
    if (t.kind === TokenKind.Semicolon || t.kind === TokenKind.LBrace || t.kind === TokenKind.RBrace) return null;
  }
  return null;
}
