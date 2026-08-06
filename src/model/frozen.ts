/**
 * A structurally-immutable {@link Repository} loaded from a compiled
 * {@link TodlDocument} (design spec §5, Component B). A published meta-model or
 * library never changes, so this seals mutation, memoizes the read path forever,
 * and freezes every entity handle. Reuses Phase 1's lazy {@link EntityBase} lens
 * and the memoized `entity()` identity map — one Entity implementation, lenses
 * over the one (now frozen) graph.
 */

import { type NodeId, type Scalar } from "./graph.js";
import { Repository, type ConceptSchema } from "./model.js";
import { graphFromJSON, type TodlDocument } from "../emit/json.js";

export class FrozenRepository extends Repository {
  private readonly fieldsCache = new Map<NodeId, Map<string, Scalar>>();
  private readonly relsCache = new Map<NodeId, Map<string, NodeId[]>>();
  private readonly schemaCache = new Map<NodeId, ConceptSchema>();
  private readonly superCache = new Map<NodeId, NodeId[]>();
  private readonly subCache = new Map<NodeId, NodeId[]>();

  /** Load a compiled document as a frozen client: eager identity-map warm + freeze. */
  static fromJSON<T extends typeof FrozenRepository>(this: T, doc: TodlDocument): InstanceType<T> {
    const frozen = new this(graphFromJSON(doc)) as InstanceType<T>;
    for (const node of frozen.allNodes()) Object.freeze(frozen.entity(node.id));
    return frozen;
  }

  /** Immutable: there is no mutation path on a compiled artifact. */
  override builder(): never {
    throw new Error("FrozenRepository is immutable — load a fresh document to change it");
  }

  override effectiveFields(leaf: NodeId): Map<string, Scalar> {
    let value = this.fieldsCache.get(leaf);
    if (value === undefined) {
      value = super.effectiveFields(leaf);
      this.fieldsCache.set(leaf, value);
    }
    return value;
  }

  override effectiveRelationships(leaf: NodeId): Map<string, NodeId[]> {
    let value = this.relsCache.get(leaf);
    if (value === undefined) {
      value = super.effectiveRelationships(leaf);
      for (const targets of value.values()) Object.freeze(targets);
      this.relsCache.set(leaf, value);
    }
    return value;
  }

  override effectiveSchema(concept: NodeId): ConceptSchema {
    let value = this.schemaCache.get(concept);
    if (value === undefined) {
      value = super.effectiveSchema(concept);
      this.schemaCache.set(concept, value);
    }
    return value;
  }

  override supertypesOf(concept: NodeId): NodeId[] {
    let value = this.superCache.get(concept);
    if (value === undefined) {
      value = super.supertypesOf(concept);
      this.superCache.set(concept, value);
    }
    return value;
  }

  override subtypesOf(concept: NodeId): NodeId[] {
    let value = this.subCache.get(concept);
    if (value === undefined) {
      value = super.subtypesOf(concept);
      this.subCache.set(concept, value);
    }
    return value;
  }
}
