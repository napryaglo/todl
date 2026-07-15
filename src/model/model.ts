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
  Cardinality,
  type Node,
  type Edge,
  type NodeId,
  type Scalar,
  type GraphChangeArgs,
} from "./graph.js";
import { Builder } from "./builder.js";
import { ReactiveNode } from "./reactive.js";
import { Derivations } from "../predicate/derivations.js";
import { Invariants, type InvariantDef } from "../predicate/invariants.js";
import type { Expr } from "../predicate/ast.js";
import { validate as runValidation, type Diagnostic } from "../validate/validate.js";

export interface FieldSchema {
  name: string;
  type: NodeId;
  cardinality: Cardinality;
}

export interface RelationshipSchema {
  name: string;
  target: NodeId;
  cardinality: Cardinality;
  inverse: string | null;
}

export interface ConceptSchema {
  concept: NodeId;
  extends: NodeId | null;
  fields: FieldSchema[];
  relationships: RelationshipSchema[];
}

export class Model {
  private readonly graph: Graph;
  private readonly derivations: Derivations;
  private readonly invariants: Invariants;

  constructor(graph: Graph = new Graph()) {
    this.graph = graph;
    this.derivations = new Derivations(this);
    this.invariants = new Invariants();
  }

  /** Register a derived member (spec §4.4): a comprehension queried per instance. */
  defineDerived(name: string, expr: Expr): void {
    this.derivations.define(name, expr);
  }

  /** Query a derived member for an instance; lazily evaluated and memoized. */
  derived(instance: NodeId, name: string): NodeId[] {
    return this.derivations.get(instance, name);
  }

  /** Register a concept invariant (spec §4.3): a predicate checked per instance. */
  defineInvariant(concept: NodeId, expr: Expr, description = ""): void {
    this.invariants.define(concept, expr, description);
  }

  /** Invariants declared directly on `concept`. */
  invariantsFor(concept: NodeId): InvariantDef[] {
    return this.invariants.for(concept);
  }

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
    return new ReactiveNode(this, id);
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

  /** Every node in the model. */
  allNodes(): Node[] {
    return this.graph.allNodes();
  }

  /** All edges leaving `id` (forward adjacency). */
  outEdges(id: NodeId): Edge[] {
    return this.graph.outEdges(id);
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

  /** Reflect a concept's declared schema (spec §5): direct parent, fields, relationships. */
  schemaOf(concept: NodeId): ConceptSchema {
    const parents = this.graph.related(concept, EdgeKind.Extends, Direction.Out);

    const fields: FieldSchema[] = [];
    for (const memberId of this.graph.related(concept, EdgeKind.HasField, Direction.Out)) {
      const node = this.graph.getNode(memberId);
      if (node === undefined) continue;
      fields.push({
        name: readString(node.attrs.get("name")),
        type: readString(node.attrs.get("type")),
        cardinality: readCardinality(node.attrs.get("cardinality")),
      });
    }

    const relationships: RelationshipSchema[] = [];
    for (const memberId of this.graph.related(concept, EdgeKind.HasRelationship, Direction.Out)) {
      const node = this.graph.getNode(memberId);
      if (node === undefined) continue;
      const inverse = node.attrs.get("inverse");
      relationships.push({
        name: readString(node.attrs.get("name")),
        target: readString(node.attrs.get("target")),
        cardinality: readCardinality(node.attrs.get("cardinality")),
        inverse: typeof inverse === "string" ? inverse : null,
      });
    }

    return { concept, extends: parents[0] ?? null, fields, relationships };
  }

  /** A concept's schema merged with everything it extends (subtype members win). */
  effectiveSchema(concept: NodeId): ConceptSchema {
    const fields = new Map<string, FieldSchema>();
    const relationships = new Map<string, RelationshipSchema>();
    for (const current of [concept, ...this.supertypesOf(concept)]) {
      const schema = this.schemaOf(current);
      for (const field of schema.fields) {
        if (!fields.has(field.name)) fields.set(field.name, field);
      }
      for (const relationship of schema.relationships) {
        if (!relationships.has(relationship.name)) relationships.set(relationship.name, relationship);
      }
    }
    return {
      concept,
      extends: this.schemaOf(concept).extends,
      fields: [...fields.values()],
      relationships: [...relationships.values()],
    };
  }

  /** Validate the model, returning structured diagnostics (spec §6). */
  validate(): Diagnostic[] {
    return runValidation(this);
  }
}

function readString(value: Scalar | undefined): string {
  return typeof value === "string" ? value : "";
}

function readCardinality(value: Scalar | undefined): Cardinality {
  return typeof value === "number" ? value : Cardinality.One;
}
