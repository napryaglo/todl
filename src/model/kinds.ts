/**
 * The meta-kind a node's `typeOf` points at when the node is an ontology
 * declaration. Shared between the {@link Builder} (which stamps it) and the
 * JS-module emitter (which partitions the ontology tier by it).
 */
export enum MetaKind {
  Concept = "concept",
  Primitive = "primitive",
  Taxonomy = "taxonomy",
  Field = "field",
  Relationship = "relationship",
}
