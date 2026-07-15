/**
 * The staging mutation API over a {@link Graph} (design spec §5, §R2).
 *
 * Edits are staged, then applied together on {@link Builder.commit}. Commit is
 * two-phase — all nodes first, then attrs and edges — so a reference may point
 * at a target staged later in the same batch (forward references). A pre-check
 * validates every staged reference before anything is written, so a bad
 * reference aborts the whole commit without partial mutation.
 *
 * Covers both tiers: instance-tier (`assertInstance` / `setField` /
 * `addRelationship`) and ontology-tier (`defineConcept` / `definePrimitive` /
 * `addField` / `addConceptRelationship`).
 */

import { Graph, EdgeKind, Tier, Cardinality, type Node, type NodeId, type Scalar } from "./graph.js";

/** Meta-kind ids a node's `typeOf` points at when it is an ontology declaration. */
const CONCEPT_KIND = "concept";
const PRIMITIVE_KIND = "primitive";
const FIELD_KIND = "field";
const RELATIONSHIP_KIND = "relationship";

interface StagedAttr {
  id: NodeId;
  name: string;
  value: Scalar;
}

interface StagedEdge {
  kind: EdgeKind;
  via: NodeId | null;
  from: NodeId;
  to: NodeId;
}

export class Builder {
  private readonly stagedNodes: Node[] = [];
  private readonly stagedAttrs: StagedAttr[] = [];
  private readonly stagedEdges: StagedEdge[] = [];

  constructor(private readonly graph: Graph) {}

  // ── Instance tier ───────────────────────────────────────────────────────

  /** Stage a new instance node typed by `typeOf`. */
  assertInstance(typeOf: NodeId, id: NodeId): this {
    this.stageNode(id, Tier.Instance, typeOf);
    return this;
  }

  /** Stage a scalar field write on `id`. */
  setField(id: NodeId, name: string, value: Scalar): this {
    this.stagedAttrs.push({ id, name, value });
    return this;
  }

  /** Stage a domain relationship edge `from -[name]-> to`. */
  addRelationship(from: NodeId, name: NodeId, to: NodeId): this {
    this.stagedEdges.push({ kind: EdgeKind.Relationship, via: name, from, to });
    return this;
  }

  // ── Ontology tier ───────────────────────────────────────────────────────

  /** Stage a primitive declaration node. */
  definePrimitive(id: NodeId): this {
    this.stageNode(id, Tier.Ontology, PRIMITIVE_KIND);
    return this;
  }

  /** Stage a concept declaration, optionally extending `extendsId`. */
  defineConcept(id: NodeId, extendsId: NodeId | null = null): this {
    this.stageNode(id, Tier.Ontology, CONCEPT_KIND);
    if (extendsId !== null) {
      this.stagedEdges.push({ kind: EdgeKind.Extends, via: null, from: id, to: extendsId });
    }
    return this;
  }

  /** Stage a field member on `concept`: a scalar/enum/ref-typed property. */
  addField(concept: NodeId, name: string, type: NodeId, cardinality: Cardinality = Cardinality.One): this {
    const memberId = `${concept}.${name}`;
    const attrs = new Map<string, Scalar>([
      ["name", name],
      ["cardinality", cardinality],
    ]);
    this.stagedNodes.push({ id: memberId, tier: Tier.Ontology, typeOf: FIELD_KIND, attrs });
    this.stagedEdges.push({ kind: EdgeKind.HasField, via: null, from: concept, to: memberId });
    this.stagedEdges.push({ kind: EdgeKind.Relationship, via: "type", from: memberId, to: type });
    return this;
  }

  /** Stage a relationship member on `concept`, targeting another concept. */
  addConceptRelationship(
    concept: NodeId,
    name: string,
    target: NodeId,
    cardinality: Cardinality = Cardinality.Many,
    inverse: string | null = null,
  ): this {
    const memberId = `${concept}.${name}`;
    const attrs = new Map<string, Scalar>([
      ["name", name],
      ["cardinality", cardinality],
    ]);
    if (inverse !== null) {
      attrs.set("inverse", inverse);
    }
    this.stagedNodes.push({ id: memberId, tier: Tier.Ontology, typeOf: RELATIONSHIP_KIND, attrs });
    this.stagedEdges.push({ kind: EdgeKind.HasRelationship, via: null, from: concept, to: memberId });
    this.stagedEdges.push({ kind: EdgeKind.Relationship, via: "target", from: memberId, to: target });
    return this;
  }

  // ── Commit ──────────────────────────────────────────────────────────────

  /** Validate every staged reference, then apply all edits and clear staging. */
  commit(): void {
    const willExist = new Set<NodeId>();
    for (const node of this.stagedNodes) {
      if (this.graph.hasNode(node.id) || willExist.has(node.id)) {
        throw new Error(`node "${node.id}" already exists`);
      }
      willExist.add(node.id);
    }

    const exists = (id: NodeId): boolean => this.graph.hasNode(id) || willExist.has(id);
    for (const attr of this.stagedAttrs) {
      if (!exists(attr.id)) {
        throw new Error(`cannot set "${attr.name}" on node "${attr.id}" — it does not exist`);
      }
    }
    for (const edge of this.stagedEdges) {
      if (!exists(edge.from)) {
        throw new Error(`edge source "${edge.from}" does not exist`);
      }
      if (!exists(edge.to)) {
        throw new Error(`edge target "${edge.to}" does not exist`);
      }
    }

    for (const node of this.stagedNodes) {
      this.graph.addNode(node);
    }
    for (const attr of this.stagedAttrs) {
      this.graph.setAttr(attr.id, attr.name, attr.value);
    }
    for (const edge of this.stagedEdges) {
      this.graph.addEdge({ kind: edge.kind, via: edge.via, from: edge.from, to: edge.to });
    }

    this.stagedNodes.length = 0;
    this.stagedAttrs.length = 0;
    this.stagedEdges.length = 0;
  }

  private stageNode(id: NodeId, tier: Tier, typeOf: NodeId): void {
    this.stagedNodes.push({ id, tier, typeOf, attrs: new Map() });
  }
}
