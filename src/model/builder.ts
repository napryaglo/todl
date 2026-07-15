/**
 * The staging mutation API over a {@link Graph} (design spec §5, §R2).
 *
 * Edits are staged, then applied together on {@link Builder.commit}. Commit is
 * two-phase — all nodes first, then attrs and edges — so a relationship may
 * reference a target asserted later in the same batch (forward references).
 * A pre-check validates every staged reference before anything is written, so
 * a bad reference aborts the whole commit without partial mutation.
 */

import { Graph, EdgeKind, Tier, type Node, type NodeId, type Scalar } from "./graph.js";

interface StagedAttr {
  id: NodeId;
  name: string;
  value: Scalar;
}

interface StagedEdge {
  from: NodeId;
  name: NodeId;
  to: NodeId;
}

export class Builder {
  private readonly stagedNodes: Node[] = [];
  private readonly stagedAttrs: StagedAttr[] = [];
  private readonly stagedEdges: StagedEdge[] = [];

  constructor(private readonly graph: Graph) {}

  /** Stage a new instance node typed by `typeOf`. */
  assertInstance(typeOf: NodeId, id: NodeId, tier: Tier = Tier.Instance): this {
    this.stagedNodes.push({ id, tier, typeOf, attrs: new Map() });
    return this;
  }

  /** Stage a scalar field write on `id`. */
  setField(id: NodeId, name: string, value: Scalar): this {
    this.stagedAttrs.push({ id, name, value });
    return this;
  }

  /** Stage a domain relationship edge `from -[name]-> to`. */
  addRelationship(from: NodeId, name: NodeId, to: NodeId): this {
    this.stagedEdges.push({ from, name, to });
    return this;
  }

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
        throw new Error(`relationship source "${edge.from}" does not exist`);
      }
      if (!exists(edge.to)) {
        throw new Error(`relationship target "${edge.to}" does not exist`);
      }
    }

    for (const node of this.stagedNodes) {
      this.graph.addNode(node);
    }
    for (const attr of this.stagedAttrs) {
      this.graph.setAttr(attr.id, attr.name, attr.value);
    }
    for (const edge of this.stagedEdges) {
      this.graph.addEdge({ kind: EdgeKind.Relationship, via: edge.name, from: edge.from, to: edge.to });
    }

    this.stagedNodes.length = 0;
    this.stagedAttrs.length = 0;
    this.stagedEdges.length = 0;
  }
}
