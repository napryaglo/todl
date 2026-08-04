import type { Range, Position } from "vscode-languageserver-types";
import type { NamespaceNode } from "../parse/ast.js";
import { visitReferences, RefRole } from "../parse/references.js";
import { spanToRange } from "./position.js";

// Occurrence roles for the editor — the language-service's view of a reference's
// kind. Derived from the shared-walk RefRole so the reference-index and the
// loader agree on WHAT a reference is; this enum stays the editor-facing surface.
export enum Role { Extends, FieldType, RelationshipTarget, RefValue, InstanceConcept, InstanceOf, Import, Represents, AnnotationName }

export interface Occurrence { uri: string; range: Range; role: Role; symbol: string }

export interface ReferenceIndex {
  get(symbol: string): Occurrence[];
  occurrenceAt(uri: string, pos: Position): Occurrence | null;
  all(): Occurrence[];
}

function roleOf(r: RefRole): Role {
  switch (r) {
    case RefRole.Extends: return Role.Extends;
    case RefRole.FieldType: return Role.FieldType;
    case RefRole.ParamType: return Role.FieldType;
    case RefRole.RelationshipTarget: return Role.RelationshipTarget;
    case RefRole.Represents: return Role.Represents;
    case RefRole.RecordConcept: return Role.InstanceConcept;
    case RefRole.InstanceOf: return Role.InstanceOf;
    case RefRole.RefValue: return Role.RefValue;
    case RefRole.AnnotationName: return Role.AnnotationName;
  }
}

export function buildReferenceIndex(files: Map<string, NamespaceNode>): ReferenceIndex {
  const occurrences: Occurrence[] = [];
  for (const [uri, ns] of files) {
    for (const span of ns.importSpans ?? []) {
      occurrences.push({ uri, symbol: "", role: Role.Import, range: spanToRange(span) });
    }
    // One shared walk — the SAME one the loader resolves through, so occurrences
    // and resolution can never disagree on what a reference is.
    for (const decl of ns.declarations) {
      visitReferences(decl, (v) => {
        if (v.span === undefined) return;
        occurrences.push({ uri, symbol: v.name, role: roleOf(v.role), range: spanToRange(v.span) });
      });
    }
  }

  const bySymbol = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const list = bySymbol.get(occ.symbol);
    if (list === undefined) bySymbol.set(occ.symbol, [occ]);
    else list.push(occ);
  }

  return {
    all: () => occurrences,
    get: (symbol) => bySymbol.get(symbol) ?? [],
    occurrenceAt: (uri, pos) =>
      occurrences.find((o) => o.uri === uri && contains(o.range, pos)) ?? null,
  };
}

function contains(range: Range, pos: Position): boolean {
  const afterStart = pos.line > range.start.line ||
    (pos.line === range.start.line && pos.character >= range.start.character);
  const beforeEnd = pos.line < range.end.line ||
    (pos.line === range.end.line && pos.character < range.end.character);
  return afterStart && beforeEnd;
}
