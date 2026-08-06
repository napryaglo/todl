/**
 * A read lens over a single model node (design spec §4, Component A). Reads
 * delegate live to the {@link Repository}, so an entity is a lazy id-keyed view
 * — never a deep copy — which preserves identity, sharing, and reverse
 * navigation. Same pattern as {@link ReactiveNode}: a type-only import of
 * Repository breaks the value cycle.
 */

import { Tier, type NodeId, type Scalar } from "./graph.js";
import type { Repository, ConceptSchema } from "./model.js";

/** Structural attrs that are markers, not authored fields (hidden from `fields`). */
const MARKER_ATTRS = new Set(["class", "id", "namespace"]);

/** The untyped base every (future) generated concept class extends. */
export interface Entity {
  readonly id: string;
  readonly concept: string; // the node's typeOf
  readonly tier: Tier;
  field(name: string): Scalar | undefined;
  readonly fields: ReadonlyMap<string, Scalar>;
  ref(member: string): Entity | undefined;
  refs(member: string): Entity[];
  referrers(member?: string): Entity[];
  /** The concept as an Entity, or undefined for a node whose typeOf is a meta-kind. */
  type(): Entity | undefined;
  schema(): ConceptSchema;
  /** True if this node's concept is, extends, or `instanceof`s `conceptOrClass`. */
  is(conceptOrClass: string): boolean;
}

export class EntityBase implements Entity {
  constructor(
    private readonly repo: Repository,
    readonly id: NodeId,
  ) {}

  get concept(): string {
    return this.repo.resolve(this.id)?.typeOf ?? "";
  }

  get tier(): Tier {
    return this.repo.resolve(this.id)?.tier ?? Tier.Instance;
  }

  field(name: string): Scalar | undefined {
    return this.repo.attr(this.id, name);
  }

  get fields(): ReadonlyMap<string, Scalar> {
    const out = new Map<string, Scalar>();
    for (const [key, value] of this.repo.effectiveFields(this.id)) {
      if (!MARKER_ATTRS.has(key)) out.set(key, value);
    }
    return out;
  }

  ref(member: string): Entity | undefined {
    const to = this.repo.ref(this.id, member);
    return to === undefined ? undefined : this.repo.entity(to);
  }

  refs(member: string): Entity[] {
    return this.mapEntities(this.repo.refs(this.id, member));
  }

  referrers(member?: string): Entity[] {
    return this.mapEntities(this.repo.referrers(this.id, member));
  }

  type(): Entity | undefined {
    return this.repo.entity(this.concept);
  }

  schema(): ConceptSchema {
    return this.repo.effectiveSchema(this.concept);
  }

  is(conceptOrClass: string): boolean {
    const concept = this.concept;
    if (concept === conceptOrClass) return true;
    if (this.repo.supertypesOf(concept).includes(conceptOrClass)) return true;
    return this.repo.classOf(this.id) === conceptOrClass;
  }

  private mapEntities(ids: readonly NodeId[]): Entity[] {
    const out: Entity[] = [];
    for (const id of ids) {
      const e = this.repo.entity(id);
      if (e !== undefined) out.push(e);
    }
    return out;
  }
}
