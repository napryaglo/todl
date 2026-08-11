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
import { MetaKind } from "./kinds.js";
import { ReactiveNode } from "./reactive.js";
import { EntityBase, type Entity } from "./entity.js";
import { Derivations } from "../predicate/derivations.js";
import { Invariants, type InvariantDef } from "../predicate/invariants.js";
import type { Expr } from "../predicate/ast.js";
import { validate as runValidation, type Diagnostic } from "../validate/validate.js";
import type { SourceSpan } from "../diagnostics/span.js";

export interface FieldSchema {
  name: string;
  type: NodeId;
  cardinality: Cardinality;
}

export interface RelationshipSchema {
  name: string;
  targets: NodeId[];
  cardinality: Cardinality;
  inverse: string | null;
}

export interface ConceptSchema {
  concept: NodeId;
  extends: NodeId | null;
  fields: FieldSchema[];
  relationships: RelationshipSchema[];
}

export class Repository {
  private readonly graph: Graph;
  private readonly derivations: Derivations;
  private readonly invariants: Invariants;
  private readonly spans = new Map<string, SourceSpan>();
  private readonly entityCache = new Map<NodeId, EntityBase>();

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

  /**
   * A memoized read lens for `id` (spec §4). Same id → same instance (identity
   * map), so references resolve to shared handles and cycles are safe. Undefined
   * when the node does not exist.
   */
  entity<T extends Entity = Entity>(id: NodeId): T | undefined {
    if (!this.has(id)) return undefined;
    let handle = this.entityCache.get(id);
    if (handle === undefined) {
      handle = this.createEntity(id);
      this.entityCache.set(id, handle);
    }
    return handle as unknown as T;
  }

  /** Construct the handle for `id`. Override to return a typed EntityBase subclass. */
  protected createEntity(id: NodeId): EntityBase {
    return new EntityBase(this, id);
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

  /** Direct child terms of a taxonomy term (one level narrower). */
  narrowerOf(term: NodeId): NodeId[] {
    return this.graph.related(term, EdgeKind.Narrower, Direction.Out);
  }

  /** Direct parent term(s) of a taxonomy term (one level broader). */
  broaderOf(term: NodeId): NodeId[] {
    return this.graph.related(term, EdgeKind.Narrower, Direction.In);
  }

  /** Every term transitively narrower than `term` (its whole branch). */
  descendantsOf(term: NodeId): NodeId[] {
    return this.graph.closure(term, EdgeKind.Narrower, Direction.Out, false);
  }

  /** Every term transitively broader than `term` (its path to the root). */
  ancestorsOf(term: NodeId): NodeId[] {
    return this.graph.closure(term, EdgeKind.Narrower, Direction.In, false);
  }

  // ── Classes + instantiation ─────────────────────────────────────────────

  /** True when a node is a class — a partial, fixed-value definition. */
  isClass(id: NodeId): boolean {
    return this.graph.getNode(id)?.attrs.get("class") === true;
  }

  /** The class a leaf instantiates (`instanceof`), or null. */
  classOf(leaf: NodeId): NodeId | null {
    return this.graph.related(leaf, EdgeKind.InstanceOf, Direction.Out)[0] ?? null;
  }

  /** Every leaf that instantiates `cls`. */
  instancesOfClass(cls: NodeId): NodeId[] {
    return this.graph.related(cls, EdgeKind.InstanceOf, Direction.In);
  }

  /** The concepts a taxonomy represents (one or more; empty if none). */
  represents(taxonomy: NodeId): NodeId[] {
    return this.graph.related(taxonomy, EdgeKind.Represents, Direction.Out);
  }

  /** Every taxonomy that represents `concept`. */
  representedBy(concept: NodeId): NodeId[] {
    return this.graph.related(concept, EdgeKind.Represents, Direction.In);
  }

  /** The concepts a viewpoint frames (one or more; empty if none). */
  frames(viewpoint: NodeId): NodeId[] {
    return this.graph.related(viewpoint, EdgeKind.Frames, Direction.Out);
  }

  /** Every viewpoint that frames `concept` directly. */
  framedBy(concept: NodeId): NodeId[] {
    return this.graph.related(concept, EdgeKind.Frames, Direction.In);
  }

  /** Every viewpoint in the model. */
  viewpoints(): NodeId[] {
    return this.instancesOf(MetaKind.Viewpoint);
  }

  /** Every viewpoint that frames `concept` OR any of its supertypes
   *  (subtype-aware: a subtype of a framed concept is framed). */
  viewpointsFraming(concept: NodeId): NodeId[] {
    const seen = new Set<NodeId>();
    for (const c of [concept, ...this.supertypesOf(concept)]) {
      for (const vp of this.framedBy(c)) seen.add(vp);
    }
    return [...seen];
  }

  /** The term (class) members of a taxonomy. */
  termsOf(taxonomy: NodeId): NodeId[] {
    return this.graph.related(taxonomy, EdgeKind.Contains, Direction.Out);
  }

  /**
   * A leaf's effective scalar fields: its own attrs overlaid with its class's
   * fixed values (class wins; the `class` / `id` markers are not inherited).
   */
  effectiveFields(leaf: NodeId): Map<string, Scalar> {
    const result = new Map<string, Scalar>(this.graph.getNode(leaf)?.attrs ?? []);
    const cls = this.classOf(leaf);
    if (cls !== null) {
      const clsAttrs = this.graph.getNode(cls)?.attrs;
      if (clsAttrs !== undefined) {
        for (const [key, value] of clsAttrs) {
          if (key !== "class" && key !== "id") result.set(key, value);
        }
      }
    }
    return result;
  }

  /**
   * A leaf's effective domain relationships (name -> targets): the union of the
   * leaf's own relationship edges with those inherited from its class.
   */
  effectiveRelationships(leaf: NodeId): Map<string, NodeId[]> {
    const result = new Map<string, NodeId[]>();
    const collect = (id: NodeId): void => {
      for (const edge of this.graph.outEdges(id)) {
        if (edge.kind !== EdgeKind.Relationship || edge.via === null) continue;
        const list = result.get(edge.via) ?? [];
        if (!list.includes(edge.to)) list.push(edge.to);
        result.set(edge.via, list);
      }
    };
    const cls = this.classOf(leaf);
    if (cls !== null) collect(cls);
    collect(leaf);
    return result;
  }

  // ── Read primitives (typed-client foundation, spec §4) ────────────────────

  /** A node's effective scalar field value (class-merged), or undefined. */
  attr(id: NodeId, name: string): Scalar | undefined {
    return this.effectiveFields(id).get(name);
  }

  /** The single target of reference member `member` (class-merged), or undefined. */
  ref(id: NodeId, member: string): NodeId | undefined {
    return this.refs(id, member)[0];
  }

  /** All targets of reference member `member` (class-merged); [] if none. */
  refs(id: NodeId, member: string): NodeId[] {
    return this.effectiveRelationships(id).get(member) ?? [];
  }

  /** Inbound reference sources (reverse adjacency), optionally filtered by member. */
  referrers(id: NodeId, member?: string): NodeId[] {
    return this.related(id, EdgeKind.Relationship, Direction.In, member ?? null);
  }

  /** Every relationship edge whose target node is absent (bulk dangling report). */
  danglingRefs(): { from: NodeId; member: string; to: NodeId }[] {
    const result: { from: NodeId; member: string; to: NodeId }[] = [];
    for (const node of this.allNodes()) {
      for (const edge of this.outEdges(node.id)) {
        if (edge.kind === EdgeKind.Relationship && edge.via !== null && !this.has(edge.to)) {
          result.push({ from: node.id, member: edge.via, to: edge.to });
        }
      }
    }
    return result;
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
        targets: this.graph.related(memberId, EdgeKind.Targets, Direction.Out),
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

  /** Record the defining source span for a node id or a member key. */
  recordSpan(key: string, span: SourceSpan): void {
    this.spans.set(key, span);
  }

  /** The span recorded for a node id or member key, or null. */
  spanOf(key: string): SourceSpan | null {
    return this.spans.get(key) ?? null;
  }

  /** Composite key for a per-instance member span. */
  static memberKey(node: NodeId, member: string): string {
    return `${node}#${member}`;
  }
}

function readString(value: Scalar | undefined): string {
  return typeof value === "string" ? value : "";
}

function readCardinality(value: Scalar | undefined): Cardinality {
  return typeof value === "number" ? value : Cardinality.One;
}
