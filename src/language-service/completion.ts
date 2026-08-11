import { CompletionItemKind, type CompletionItem, type Position } from "vscode-languageserver-types";
import type { Analysis } from "./analysis.js";
import { classifyPosition, ContextKind } from "./classifier.js";
import { SymbolKind, symbolKindOf } from "./symbols.js";
import { assignmentContextAt } from "./schema-context.js";

const KEYWORDS = ["namespace", "import", "concept", "primitive", "taxonomy", "relationship", "invariant", "instanceof"];

export function completionsAt(a: Analysis, uri: string, pos: Position): CompletionItem[] {
  const ctx = classifyPosition(a, uri, pos);
  switch (ctx.kind) {
    case ContextKind.TypeSlot:
      return typeCandidates(a);
    case ContextKind.RelationshipTarget:
      return conceptCandidates(a);
    case ContextKind.RefValue:
      return refCandidates(a, uri, pos);
    case ContextKind.None:
      // Top-level (or unclassified) — offer the declaration keywords.
      return KEYWORDS.map((label) => ({ label, kind: CompletionItemKind.Keyword }));
    default:
      return [];
  }
}

// Concepts + primitives + taxonomies are valid in a field-type slot.
function typeCandidates(a: Analysis): CompletionItem[] {
  return nodesOfKinds(a, [SymbolKind.Concept, SymbolKind.Primitive, SymbolKind.Taxonomy]);
}

function conceptCandidates(a: Analysis): CompletionItem[] {
  return nodesOfKinds(a, [SymbolKind.Concept]);
}

function nodesOfKinds(a: Analysis, kinds: SymbolKind[]): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const node of a.model.allNodes()) {
    const kind = symbolKindOf(a.model, node.id);
    if (!kinds.includes(kind)) continue;
    items.push(withDoc({
      label: node.id,
      kind: kind === SymbolKind.Primitive ? CompletionItemKind.Struct : CompletionItemKind.Class,
      detail: labelFor(kind),
    }, describe(a, node.id)));
  }
  return items;
}

// A `&ref` value: offer instances of the assignment's target concept and its
// subtypes. Falls back to all instances when the slot's target can't be resolved
// (e.g. the member isn't in the schema).
function refCandidates(a: Analysis, uri: string, pos: Position): CompletionItem[] {
  const ctx = assignmentContextAt(a, uri, pos);
  const ids = ctx !== null && ctx.targetConcepts.length > 0
    ? [...new Set(ctx.targetConcepts.flatMap((c) => instancesForConcept(a, c)))]
    : allInstanceIds(a);
  return ids.map((id) => withDoc({ label: id, kind: CompletionItemKind.Variable }, describe(a, id)));
}

function instancesForConcept(a: Analysis, concept: string): string[] {
  const ids = new Set<string>(a.model.instancesOf(concept));
  for (const sub of a.model.subtypesOf(concept)) for (const i of a.model.instancesOf(sub)) ids.add(i);
  return [...ids];
}

function allInstanceIds(a: Analysis): string[] {
  return a.model.allNodes().filter((n) => symbolKindOf(a.model, n.id) === SymbolKind.Instance).map((n) => n.id);
}

// Attach documentation only when present — `exactOptionalPropertyTypes` forbids
// an explicit `documentation: undefined`.
function withDoc(item: CompletionItem, doc: string | undefined): CompletionItem {
  return doc === undefined ? item : { ...item, documentation: doc };
}

function labelFor(kind: SymbolKind): string {
  return kind === SymbolKind.Concept ? "concept"
    : kind === SymbolKind.Primitive ? "primitive"
    : kind === SymbolKind.Taxonomy ? "taxonomy" : "symbol";
}

function describe(a: Analysis, id: string): string | undefined {
  const d = a.model.resolve(id)?.attrs.get("description");
  return typeof d === "string" && d.length > 0 ? d : undefined;
}
