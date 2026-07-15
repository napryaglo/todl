/**
 * Reactive facade over a model node (design spec §R2) — TODL's analog of C#'s
 * `INotifyPropertyChanged` / `INotifyCollectionChanged`. It is the contract
 * Mural's bindings observe. TODL owns it because TODL stands alone and Mural
 * depends on TODL, never the reverse.
 *
 * A change to a member is routed by the member's schema cardinality: single
 * members (`T` / `T?`) raise `propertyChanged`; multi members (`T[]` / `T[+]`)
 * raise `collectionChanged` with the affected item. Members with no schema
 * entry are treated as single-valued.
 */

import { Signal, type Disposable } from "../core/signal.js";
import {
  EdgeKind,
  Direction,
  Cardinality,
  GraphChangeKind,
  type NodeId,
  type Scalar,
  type GraphChangeArgs,
} from "./graph.js";
import type { Model } from "./model.js";

export enum PropertyChangeKind {
  Set,
  Cleared,
}

export interface PropertyChangedArgs {
  property: string;
  kind: PropertyChangeKind;
}

export interface INotifyPropertyChanged {
  readonly propertyChanged: Signal<PropertyChangedArgs>;
}

export enum CollectionChangeKind {
  Added,
  Removed,
}

export interface CollectionChangedArgs {
  property: string;
  kind: CollectionChangeKind;
  item: NodeId;
}

export interface INotifyCollectionChanged {
  readonly collectionChanged: Signal<CollectionChangedArgs>;
}

export class ReactiveNode implements INotifyPropertyChanged, INotifyCollectionChanged {
  readonly propertyChanged = new Signal<PropertyChangedArgs>();
  readonly collectionChanged = new Signal<CollectionChangedArgs>();
  private readonly subscription: Disposable;

  constructor(
    private readonly model: Model,
    readonly id: NodeId,
  ) {
    if (model.resolve(id) === undefined) {
      throw new Error(`node "${id}" does not exist`);
    }
    this.subscription = model.changed.subscribe((change) => this.onChange(change));
  }

  /** Read a property by name: a scalar attr, or the ids of its forward relationship edges. */
  get(name: string): Scalar | NodeId[] | undefined {
    const node = this.model.resolve(this.id);
    if (node === undefined) return undefined;
    const scalar = node.attrs.get(name);
    if (scalar !== undefined) return scalar;
    const targets = this.model.related(this.id, EdgeKind.Relationship, Direction.Out, name);
    return targets.length > 0 ? targets : undefined;
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private onChange(change: GraphChangeArgs): void {
    if (change.node !== this.id || change.property === null) return;

    if (this.isCollection(change.property)) {
      if (change.target === null) return;
      const kind =
        change.kind === GraphChangeKind.EdgeRemoved ? CollectionChangeKind.Removed : CollectionChangeKind.Added;
      this.collectionChanged.emit({ property: change.property, kind, item: change.target });
    } else {
      const kind =
        change.kind === GraphChangeKind.EdgeRemoved ? PropertyChangeKind.Cleared : PropertyChangeKind.Set;
      this.propertyChanged.emit({ property: change.property, kind });
    }
  }

  private isCollection(name: string): boolean {
    const concept = this.model.resolve(this.id)?.typeOf;
    if (concept === undefined) return false;
    const schema = this.model.effectiveSchema(concept);
    const member =
      schema.fields.find((field) => field.name === name) ??
      schema.relationships.find((relationship) => relationship.name === name);
    if (member === undefined) return false;
    return member.cardinality === Cardinality.Many || member.cardinality === Cardinality.NonEmpty;
  }
}
