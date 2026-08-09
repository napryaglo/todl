/**
 * A mutable authoring overlay over frozen bases (design spec §7, Component D). A
 * user builds a model by adding typed instances whose reference fields point into
 * the frozen bases (cross-boundary) or at each other.
 *
 * Delta-based: the source of truth is an own `TodlDocument` ({nodes, edges}) that
 * mutators edit directly; the combined working `Repository` (bases ∪ own) is
 * DERIVED on demand and cached, invalidated on every mutation. Only ids added
 * after `on()`/`fromSource()` are "own"; `toJSON()` emits just that delta. Bases
 * are frozen — mutators touch own instances only.
 */

import { Tier, EdgeKind, type NodeId, type Scalar, type Node } from "../model/graph.js";
import { Repository, type FieldSchema } from "../model/model.js";
import { type Entity } from "../model/entity.js";
import { toJSON, fromJSON, type TodlDocument } from "../emit/json.js";
import { checkAgainst } from "../api.js";
import { parse } from "../parse/parser.js";
import { collectDefinitions } from "../parse/references.js";
import { preludeDocument } from "../stdlib/prelude.js";
import { deriveBindings, emitModelTodl } from "../emit/todl.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";

const INSTANCE_TIER = Tier[Tier.Instance];
const RELATIONSHIP = EdgeKind[EdgeKind.Relationship];
const MODEL_TYPEOF = "model";

/** A plain instance record; Phase 5 codegen emits these, Phase 4 accepts them. */
export interface InstanceDescriptor {
  concept: string;
  id: string;
  scalars?: ReadonlyMap<string, Scalar>;
  refs?: ReadonlyMap<string, readonly NodeId[]>;
}

export class ModelDraft {
  private own: TodlDocument = { nodes: [], edges: [] };
  private modelCache: Repository | undefined = undefined;
  private readonly baseIds: ReadonlySet<NodeId>;
  /** Home file (source uri) of each own node — the file it round-trips to. */
  private readonly home = new Map<NodeId, string>();

  private constructor(
    /** The frozen bases as documents: [prelude, ...bases]. */
    private readonly baseDocs: readonly TodlDocument[],
    readonly namespace: string,
  ) {
    this.baseIds = new Set(baseDocs.flatMap((d) => d.nodes.map((n) => n.id)));
  }

  /** Open an empty draft over the given frozen bases (meta-model + libraries). */
  static on(bases: readonly Repository[], opts: { namespace: string }): ModelDraft {
    return new ModelDraft([preludeDocument(), ...bases.map((b) => toJSON(b))], opts.namespace);
  }

  /** Reopen a saved `.todl` model as an editable draft: compile it against the
   *  bases and seed the own delta with the non-base instances. A blank source
   *  yields an empty draft. */
  static fromSource(bases: readonly Repository[], source: string, opts: { namespace: string }): ModelDraft {
    const draft = new ModelDraft([preludeDocument(), ...bases.map((b) => toJSON(b))], opts.namespace);
    if (source.trim().length === 0) return draft;
    const compiled = toJSON(checkAgainst([...draft.baseDocs], [{ uri: `${opts.namespace}.todl`, text: source }]).model);
    // Drop the synthesized `model`-container node (typeOf "model") + its Contains
    // edges — it is a serialization artifact, not an editable instance.
    const modelIds = new Set(compiled.nodes.filter((n) => n.typeOf === MODEL_TYPEOF).map((n) => n.id));
    draft.own = {
      nodes: compiled.nodes.filter((n) => !draft.baseIds.has(n.id) && !modelIds.has(n.id)),
      edges: compiled.edges.filter((e) => !draft.baseIds.has(String(e.from)) && !modelIds.has(String(e.from))),
    };
    return draft;
  }

  /** Reopen SEVERAL `.todl` files as one editable draft (Option B: one model,
   *  many files). Composes them against the bases and records each own node's
   *  home file (the file that defined it) for per-file round-trip. */
  static fromSources(
    bases: readonly Repository[],
    sources: readonly { uri: string; text: string }[],
    opts: { namespace: string },
  ): ModelDraft {
    const draft = new ModelDraft([preludeDocument(), ...bases.map((b) => toJSON(b))], opts.namespace);
    const compiled = toJSON(checkAgainst([...draft.baseDocs], sources.map((s) => ({ uri: s.uri, text: s.text }))).model);
    const modelIds = new Set(compiled.nodes.filter((n) => n.typeOf === MODEL_TYPEOF).map((n) => n.id));
    draft.own = {
      nodes: compiled.nodes.filter((n) => !draft.baseIds.has(n.id) && !modelIds.has(n.id)),
      edges: compiled.edges.filter((e) => !draft.baseIds.has(String(e.from)) && !modelIds.has(String(e.from))),
    };
    // Provenance: which file defined each own id (re-parse — cheap; the model
    // container id is skipped since it's not an own node).
    const ownIds = new Set(draft.own.nodes.map((n) => n.id));
    for (const s of sources) {
      const { namespace } = parse(s.text, s.uri);
      const defined = new Set<string>();
      for (const decl of namespace.declarations) collectDefinitions(decl, namespace.path, defined, new Map());
      for (const id of defined) if (ownIds.has(id)) draft.home.set(id, s.uri);
    }
    return draft;
  }

  /** The home file (source uri) of an own node, or undefined. */
  homeOf(id: NodeId): string | undefined {
    return this.home.get(id);
  }

  /** The combined working Repository (bases ∪ own), derived + cached. */
  get model(): Repository {
    if (this.modelCache === undefined) {
      const nodes = new Map<NodeId, TodlDocument["nodes"][number]>();
      for (const n of [...this.baseDocs.flatMap((d) => d.nodes), ...this.own.nodes]) nodes.set(n.id, n);
      const edges = new Map<string, TodlDocument["edges"][number]>();
      for (const e of [...this.baseDocs.flatMap((d) => d.edges), ...this.own.edges])
        edges.set(`${e.kind}|${e.from}|${e.to}|${e.via}`, e);
      this.modelCache = fromJSON({ nodes: [...nodes.values()], edges: [...edges.values()] });
    }
    return this.modelCache;
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

  /** Stage an instance (attrs + reference edges) into the overlay; return its
   *  handle. Fail-fast: throws (atomically, before any mutation) if a reference
   *  target does not exist — no dangling refs are ever staged. */
  add(descriptor: InstanceDescriptor): Entity {
    const known = new Set<NodeId>([...this.baseIds, ...this.own.nodes.map((n) => n.id), descriptor.id]);
    for (const [, targets] of descriptor.refs ?? [])
      for (const t of targets)
        if (!known.has(t)) throw new Error(`reference target "${t}" does not exist`);
    this.create(descriptor.concept, descriptor.id);
    for (const [name, value] of descriptor.scalars ?? []) this.setField(descriptor.id, name, value);
    for (const [member, targets] of descriptor.refs ?? [])
      for (const target of targets) this.addRef(descriptor.id, member, target);
    return this.model.entity(descriptor.id)!;
  }

  /** Append a fresh own instance of `concept` with the given id; return its
   *  handle. `home` records the file it round-trips to (see toTodlByFile). */
  create(concept: string, id: NodeId, home?: string): Entity {
    this.own.nodes.push({ id, tier: INSTANCE_TIER, typeOf: concept, attrs: { id } });
    if (home !== undefined) this.home.set(id, home);
    this.invalidate();
    return this.model.entity(id)!;
  }

  /** Set a scalar attr on an OWN instance. Throws for a base (frozen) or unknown id. */
  setField(id: NodeId, name: string, value: Scalar): void {
    const node = this.ownNode(id);
    (node.attrs as Record<string, Scalar>)[name] = value;
    this.invalidate();
  }

  /** Append a reference edge from an OWN instance. Throws if `from` is not own or
   *  `to` does not exist. */
  addRef(from: NodeId, member: string, to: NodeId): void {
    this.ownNode(from);
    if (!this.baseIds.has(to) && !this.own.nodes.some((n) => n.id === to))
      throw new Error(`reference target "${to}" does not exist`);
    this.own.edges.push({ kind: RELATIONSHIP, via: member, from, to });
    this.invalidate();
  }

  /** Drop a matching reference edge (no-op if absent). */
  removeRef(from: NodeId, member: string, to: NodeId): void {
    this.own.edges = this.own.edges.filter(
      (e) => !(e.kind === RELATIONSHIP && e.from === from && e.via === member && e.to === to),
    );
    this.invalidate();
  }

  /** Remove an own instance and every edge touching it. Throws for a base id. */
  remove(id: NodeId): void {
    if (this.baseIds.has(id)) throw new Error(`cannot remove base node "${id}" (frozen)`);
    this.own.nodes = this.own.nodes.filter((n) => n.id !== id);
    this.own.edges = this.own.edges.filter((e) => e.from !== id && e.to !== id);
    this.invalidate();
  }

  /** The reference members of `fromId`'s concept that `toId` could fill — the
   *  concept-typed fields whose type `toId` is (or is a subtype of). */
  referenceMembers(fromId: NodeId, toId: NodeId): FieldSchema[] {
    const fromConcept = this.model.resolve(fromId)?.typeOf;
    const toConcept = this.model.resolve(toId)?.typeOf;
    if (fromConcept === undefined || toConcept === undefined) return [];
    const compatible = new Set([toConcept, ...this.model.supertypesOf(toConcept)]);
    return this.model.effectiveSchema(fromConcept).fields.filter((f) => compatible.has(f.type));
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

  /** Serialize ONLY the overlay delta: own instances + their edges. */
  toJSON(): TodlDocument {
    return {
      nodes: this.own.nodes.map((n) => ({ ...n, attrs: { ...(n.attrs as Record<string, Scalar>) } })),
      edges: this.own.edges.map((e) => ({ ...e })),
    };
  }

  /** Serialize the overlay as round-trippable `.todl` model source (own delta + bindings). */
  toTodl(): string {
    const own = this.toJSON();
    const bindings = deriveBindings(this.model, this.baseIds, this.namespace, own);
    return emitModelTodl(own, this.namespace, bindings, this.conformsOf(own));
  }

  /** Serialize the overlay as one `.todl` per home file (Option B multi-file):
   *  own nodes/edges partitioned by home, each file emitting its own model block
   *  with its `conforms <viewpoint>`. Nodes with no recorded home fall to a
   *  single default `${namespace}.todl`. */
  toTodlByFile(): Map<string, string> {
    const defaultUri = `${this.namespace}.todl`;
    const files = new Map<string, TodlDocument>();
    const ensure = (uri: string): TodlDocument => {
      let doc = files.get(uri);
      if (doc === undefined) { doc = { nodes: [], edges: [] }; files.set(uri, doc); }
      return doc;
    };
    const own = this.toJSON();
    for (const n of own.nodes) ensure(this.home.get(n.id) ?? defaultUri).nodes.push(n);
    for (const e of own.edges) ensure(this.home.get(String(e.from)) ?? defaultUri).edges.push(e);
    const result = new Map<string, string>();
    for (const [uri, doc] of files) {
      const bindings = deriveBindings(this.model, this.baseIds, this.namespace, doc);
      result.set(uri, emitModelTodl(doc, this.namespace, bindings, this.conformsOf(doc)));
    }
    return result;
  }

  /** The shared `conforms` viewpoint of a file's concrete entities (file↔viewpoint
   *  1:1), or undefined when none carry one. */
  private conformsOf(doc: TodlDocument): string | undefined {
    for (const n of doc.nodes) {
      const c = (n.attrs as Record<string, Scalar>).conforms;
      if (typeof c === "string") return c;
    }
    return undefined;
  }

  /** True when `id` is base (frozen), false when it is an own overlay instance. */
  protected isBase(id: NodeId): boolean {
    return this.baseIds.has(id);
  }

  /** An own node by id, or throw (base id → frozen; unknown → no such instance). */
  private ownNode(id: NodeId): TodlDocument["nodes"][number] {
    if (this.baseIds.has(id)) throw new Error(`cannot mutate base node "${id}" (frozen)`);
    const node = this.own.nodes.find((n) => n.id === id);
    if (node === undefined) throw new Error(`no own instance "${id}"`);
    return node;
  }

  private invalidate(): void {
    this.modelCache = undefined;
  }
}
