/**
 * Reactive facade over a graph node (design spec §R2) — TODL's analog of C#'s
 * `INotifyPropertyChanged`. It is the contract Mural's bindings observe. TODL
 * owns it because TODL stands alone and Mural depends on TODL, never the
 * reverse.
 *
 * This first cut delivers the property-change half. `INotifyCollectionChanged`
 * (item-level add/remove for `[]` / `[+]` members) needs concept cardinality
 * to route scalar-vs-collection changes, so it lands with the schema layer.
 */

import { Signal, type Disposable } from "../core/signal.js";
import {
  Graph,
  EdgeKind,
  Direction,
  GraphChangeKind,
  type NodeId,
  type Scalar,
} from "./graph.js";

export enum PropertyChangeKind {
  Set,
  Cleared,
}

export interface PropertyChangedArgs {
  /** Field / relationship name that changed. */
  property: string;
  kind: PropertyChangeKind;
}

export interface INotifyPropertyChanged {
  readonly propertyChanged: Signal<PropertyChangedArgs>;
}

/**
 * A live view of one node. Subscribes to the graph change bus, filters to its
 * own node, and re-raises property-level notifications. Dispose to detach.
 */
export class ReactiveNode implements INotifyPropertyChanged {
  readonly propertyChanged = new Signal<PropertyChangedArgs>();
  private readonly subscription: Disposable;

  constructor(
    private readonly graph: Graph,
    readonly id: NodeId,
  ) {
    if (!graph.hasNode(id)) {
      throw new Error(`node "${id}" does not exist`);
    }
    this.subscription = graph.changed.subscribe((change) => {
      if (change.node !== this.id || change.property === null) return;
      const kind =
        change.kind === GraphChangeKind.EdgeRemoved
          ? PropertyChangeKind.Cleared
          : PropertyChangeKind.Set;
      this.propertyChanged.emit({ property: change.property, kind });
    });
  }

  /** Read a property by name: a scalar attr, or the ids of its forward relationship edges. */
  get(name: string): Scalar | NodeId[] | undefined {
    const node = this.graph.getNode(this.id);
    if (node === undefined) return undefined;
    const scalar = node.attrs.get(name);
    if (scalar !== undefined) return scalar;
    const targets = this.graph.related(this.id, EdgeKind.Relationship, Direction.Out, name);
    return targets.length > 0 ? targets : undefined;
  }

  dispose(): void {
    this.subscription.dispose();
  }
}
