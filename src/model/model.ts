/**
 * The public runtime facade (design spec §5). Wraps a {@link Graph} and exposes
 * the read + construct surface an agent works through: resolve / instancesOf /
 * related / closure / subtype queries, plus a staging {@link Builder} and a
 * reactive {@link ReactiveNode} view. Low-level store mutators stay on Graph;
 * callers mutate through the builder.
 */

import { Signal } from "../core/signal.js";
import {
  Graph,
  EdgeKind,
  Direction,
  type Node,
  type NodeId,
  type GraphChangeArgs,
} from "./graph.js";
import { Builder } from "./builder.js";
import { ReactiveNode } from "./reactive.js";

export class Model {
  constructor(private readonly graph: Graph = new Graph()) {}

  /** The mutation change stream (spec §R2). */
  get changed(): Signal<GraphChangeArgs> {
    return this.graph.changed;
  }

  /** A staging mutation batch; call `commit()` to apply. */
  builder(): Builder {
    return new Builder(this.graph);
  }

  /** A live reactive view of one node. */
  view(id: NodeId): ReactiveNode {
    return new ReactiveNode(this.graph, id);
  }

  resolve(id: NodeId): Node | undefined {
    return this.graph.getNode(id);
  }

  has(id: NodeId): boolean {
    return this.graph.hasNode(id);
  }

  instancesOf(concept: NodeId): NodeId[] {
    return this.graph.instancesOf(concept);
  }

  related(id: NodeId, kind: EdgeKind, direction: Direction, via: NodeId | null = null): NodeId[] {
    return this.graph.related(id, kind, direction, via);
  }

  closure(
    start: NodeId,
    kind: EdgeKind,
    direction: Direction,
    reflexive: boolean,
    via: NodeId | null = null,
  ): NodeId[] {
    return this.graph.closure(start, kind, direction, reflexive, via);
  }

  /** All concepts that transitively extend `concept`. */
  subtypesOf(concept: NodeId): NodeId[] {
    return this.graph.closure(concept, EdgeKind.Extends, Direction.In, false);
  }

  /** All concepts `concept` transitively extends. */
  supertypesOf(concept: NodeId): NodeId[] {
    return this.graph.closure(concept, EdgeKind.Extends, Direction.Out, false);
  }
}
