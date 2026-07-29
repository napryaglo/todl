import type { Range, Position } from "vscode-languageserver-types";
import type { SourceSpan } from "../diagnostics/span.js";
import {
  DeclKind, ValueKind,
  type NamespaceNode, type Declaration, type InstanceDecl, type TaxonomyDecl, type ValueNode,
} from "../parse/ast.js";
import { spanToRange } from "./position.js";

export enum Role { Extends, FieldType, RelationshipTarget, RefValue, InstanceConcept, InstanceOf, Import, Represents }

export interface Occurrence { uri: string; range: Range; role: Role; symbol: string }

export interface ReferenceIndex {
  get(symbol: string): Occurrence[];
  occurrenceAt(uri: string, pos: Position): Occurrence | null;
  all(): Occurrence[];
}

type Push = (uri: string, symbol: string, span: SourceSpan | undefined, role: Role) => void;

export function buildReferenceIndex(files: Map<string, NamespaceNode>): ReferenceIndex {
  const occurrences: Occurrence[] = [];
  const push: Push = (uri, symbol, span, role) => {
    if (span === undefined) return;
    occurrences.push({ uri, symbol, role, range: spanToRange(span) });
  };

  for (const [uri, ns] of files) {
    for (const span of ns.importSpans ?? []) {
      occurrences.push({ uri, symbol: "", role: Role.Import, range: spanToRange(span) });
    }
    for (const decl of ns.declarations) walkDecl(uri, decl, push);
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

function walkDecl(uri: string, decl: Declaration, push: Push): void {
  if (decl.kind === DeclKind.Concept) {
    if (decl.extends !== null) push(uri, decl.extends, decl.extendsSpan, Role.Extends);
    for (const f of decl.fields) push(uri, f.type, f.typeSpan, Role.FieldType);
    for (const r of decl.relationships) push(uri, r.target, r.targetSpan, Role.RelationshipTarget);
  } else if (decl.kind === DeclKind.Instance) {
    walkInstance(uri, decl, push);
  } else if (decl.kind === DeclKind.Taxonomy) {
    walkTaxonomy(uri, decl, push);
  }
}

function walkTaxonomy(uri: string, decl: TaxonomyDecl, push: Push): void {
  // `taxonomy X : represents C1, C2` — each target references a concept.
  decl.represents.forEach((concept, i) => push(uri, concept, decl.representsSpans?.[i], Role.Represents));
}

function walkInstance(uri: string, inst: InstanceDecl, push: Push): void {
  push(uri, inst.concept, inst.conceptSpan, Role.InstanceConcept);
  if (inst.instanceOf !== null) push(uri, inst.instanceOf, inst.instanceOfSpan, Role.InstanceOf);
  for (const a of inst.assignments) pushRefs(uri, a.value, push);
  for (const child of inst.children) walkInstance(uri, child, push);
}

function pushRefs(uri: string, value: ValueNode, push: Push): void {
  if (value.kind === ValueKind.Ref) push(uri, value.ref, value.span, Role.RefValue);
  else if (value.kind === ValueKind.List) for (const item of value.items) pushRefs(uri, item, push);
}

function contains(range: Range, pos: Position): boolean {
  const afterStart = pos.line > range.start.line ||
    (pos.line === range.start.line && pos.character >= range.start.character);
  const beforeEnd = pos.line < range.end.line ||
    (pos.line === range.end.line && pos.character < range.end.character);
  return afterStart && beforeEnd;
}
