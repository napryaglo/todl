/**
 * A mutable authoring overlay over frozen bases (design spec §7, Component D). A
 * user builds a model by adding typed instances whose reference fields point into
 * the frozen bases (cross-boundary) or at each other. The overlay composes ONE
 * working Repository exactly as `checkAgainst` does — bases merged into a graph,
 * instances staged on top via the Builder — so cross-boundary references are
 * ordinary edges into present base nodes. Only ids added after `on()` are "own";
 * `toJSON()` emits just that delta.
 */

import { Tier, EdgeKind, type NodeId, type Scalar, type Node } from "../model/graph.js";
import { Repository } from "../model/model.js";
import { type Entity } from "../model/entity.js";
import { toJSON, type TodlDocument } from "../emit/json.js";
import { mergeBases } from "../api.js";
import { preludeDocument } from "../stdlib/prelude.js";
import { deriveBindings, emitModelTodl } from "../emit/todl.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";

/** A plain instance record; Phase 5 codegen emits these, Phase 4 accepts them. */
export interface InstanceDescriptor {
  concept: string;
  id: string;
  scalars?: ReadonlyMap<string, Scalar>;
  refs?: ReadonlyMap<string, readonly NodeId[]>;
}

export class ModelDraft {
  private readonly baseIds: ReadonlySet<NodeId>;

  private constructor(
    readonly model: Repository,
    readonly namespace: string,
  ) {
    this.baseIds = new Set(model.allNodes().map((n) => n.id));
  }

  /** Open a draft over the given frozen bases (meta-model + libraries). */
  static on(bases: readonly Repository[], opts: { namespace: string }): ModelDraft {
    const graph = mergeBases([preludeDocument(), ...bases.map((b) => toJSON(b))]);
    return new ModelDraft(new Repository(graph), opts.namespace);
  }

  resolve(id: NodeId): Node | undefined {
    return this.model.resolve(id);
  }

  has(id: NodeId): boolean {
    return this.model.has(id);
  }

  entity(id: NodeId): Entity | undefined {
    return this.model.entity(id);
  }

  /** Stage an instance (attrs + reference edges) into the overlay; return its handle. */
  add(descriptor: InstanceDescriptor): Entity {
    const builder = this.model.builder();
    builder.assertInstance(descriptor.concept, descriptor.id);
    for (const [name, value] of descriptor.scalars ?? []) builder.setField(descriptor.id, name, value);
    for (const [member, targets] of descriptor.refs ?? []) {
      for (const target of targets) builder.addRelationship(descriptor.id, member, target);
    }
    builder.commit(); // throws if a reference target does not exist (fail-fast)
    return this.model.entity(descriptor.id)!;
  }

  /** The overlay's own instances (excludes all base nodes). */
  ownInstances(): Entity[] {
    return this.model
      .allNodes()
      .filter((n) => !this.isBase(n.id))
      .map((n) => this.model.entity(n.id)!);
  }

  /** Validate the overlay against the frozen bases (the vocabulary). */
  get diagnostics(): Diagnostic[] {
    return this.model.validate();
  }

  /** Serialize ONLY the overlay delta: own instances + the edges leaving them.
   *  Cross-boundary edges are kept by target id; frozen bases are never copied. */
  toJSON(): TodlDocument {
    const nodes: TodlDocument["nodes"] = [];
    const edges: TodlDocument["edges"] = [];
    for (const node of this.model.allNodes()) {
      if (this.isBase(node.id)) continue;
      nodes.push({
        id: node.id,
        tier: Tier[node.tier],
        typeOf: node.typeOf,
        attrs: Object.fromEntries(node.attrs),
      });
      for (const edge of this.model.outEdges(node.id)) {
        edges.push({ kind: EdgeKind[edge.kind], via: edge.via, from: edge.from, to: edge.to });
      }
    }
    return { nodes, edges };
  }

  /** Serialize the overlay as round-trippable `.todl` model source (own delta + bindings). */
  toTodl(): string {
    const own = this.toJSON();
    const bindings = deriveBindings(this.model, this.baseIds, this.namespace, own);
    return emitModelTodl(own, this.namespace, bindings);
  }

  /** True when `id` is base (frozen), false when it is an own overlay instance. */
  protected isBase(id: NodeId): boolean {
    return this.baseIds.has(id);
  }
}
