/**
 * The meta-kind a node's `typeOf` points at when the node is an ontology
 * declaration. Shared between the {@link Builder} (which stamps it) and the
 * JS-module emitter (which partitions the ontology tier by it).
 */
export enum MetaKind {
  Concept = "concept",
  Primitive = "primitive",
  Taxonomy = "taxonomy",
  Viewpoint = "viewpoint",
  Field = "field",
  Relationship = "relationship",
  Model = "model",
  Annotation = "annotation",
  Package = "package",
  Operator = "operator",
}

/** Reserved id of the singleton package node that hosts package-level annotations. */
export const PACKAGE_NODE_ID = "package";
