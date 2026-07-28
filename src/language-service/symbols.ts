import type { NodeId } from "../model/graph.js";
import { Tier } from "../model/graph.js";
import { MetaKind } from "../model/kinds.js";
import type { Repository } from "../model/model.js";

// The kind of a resolved symbol, from the reflective graph. Ontology nodes stamp
// their MetaKind on `typeOf` (see Builder); instances live in the Instance tier,
// and a class-marked instance is a taxonomy term.
export enum SymbolKind {
  Concept, Primitive, Taxonomy, Term, Instance, Field, Relationship, Unknown,
}

export function symbolKindOf(model: Repository, id: NodeId): SymbolKind {
  const node = model.resolve(id);
  if (node === undefined) return SymbolKind.Unknown;
  if (node.tier === Tier.Ontology) {
    switch (node.typeOf) {
      case MetaKind.Concept:      return SymbolKind.Concept;
      case MetaKind.Primitive:    return SymbolKind.Primitive;
      case MetaKind.Taxonomy:     return SymbolKind.Taxonomy;
      case MetaKind.Field:        return SymbolKind.Field;
      case MetaKind.Relationship: return SymbolKind.Relationship;
      default:                    return SymbolKind.Unknown;
    }
  }
  if (node.tier === Tier.Instance) {
    return model.isClass(id) ? SymbolKind.Term : SymbolKind.Instance;
  }
  return SymbolKind.Unknown;
}
