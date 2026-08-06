# Typed Repository Clients & Model Authoring — Design

**Date:** 2026-08-06
**Status:** 🚧 In progress — **Phases 1–6 DONE** and merged + pushed to `main` (2026-08-06; 416/416 green, typecheck + build clean). **Phase 6 (Component F, in-memory):** `GraphStore` interface + `InMemoryGraphStore` (Graph's maps lifted out + `remove`/`commit`), a reusable `describeGraphStore` conformance suite, and `Graph` delegating storage to a swappable store (default in-memory) while keeping the `changed` bus + `related`/`closure`; behavior-preserving. Only **Phase 7 (Cypher/graph-DB store)** remains. **Phase 5 (Component E):** the read-client generator also emits a typed authoring constructor per concept on the package class (`client.<concept>(id, {fields}) → InstanceDescriptor`; reference params entity-typed, reduced to ids, cardinality-shaped), feeding `ModelDraft.add` end-to-end; deferred: many-valued scalar params, `draft.<concept>(…)` alias. **Phase 1 (Component A):** `Repository.entity()`/`attr`/`ref`/`refs`/`referrers`/`danglingRefs`, `Entity`/`EntityBase`, exported. **Phase 2 (Component B):** `FrozenRepository` — sealed (`builder()` throws), memoized read path, frozen shared handles, polymorphic `fromJSON`, `graphFromJSON`. **Phase 3 (Component C):** `createEntity` construction seam + `generateReadClient(repo, {name})` → typed package class (registry + collection accessors) + entity classes (scalar/reference getters), golden-fixture tested. **Phase 4 (Component D, MVP):** `ModelDraft.on(bases, {namespace})` combined working model (mergeBases+prelude, mergeBases now exported) + `add(descriptor)` (scalars + cross-boundary/own refs, fail-fast) + `diagnostics` (validate) + `toJSON()` own-delta (recomposes with bases). **Phase 7 not started** (Cypher/graph-DB `GraphStore`). Deviations: `type()` returns `Entity | undefined` (no-throw); Phase 2 chose seal+memoize over spec §5's self-contained eager handles (one Entity impl); the Phase 3 generator reflects one resolved graph (caller composes meta-model + library); Phase 4 MVP defers `remove`/`transact`/`commit`, `toTodl()` text, delta binding-header/model-container, and `danglingRefs()` positive case (authoring can't dangle — targets must exist). Plans: `docs/superpowers/plans/2026-08-06-typed-repository-clients-phase{1,2,3,4,5,6}-*.md`.
**Component:** TODL (`@pragmatic-lab/todl`) — runtime, a `GraphStore` seam, code generation, and a mutable authoring layer. Downstream consumer: Plexus.

---

## 1. Vision

Today a consumer of a compiled TODL artifact (`model.json`) gets a `Repository`
whose only ergonomic surface is a low-level graph API (`related(id, EdgeKind,
Direction, via)`, `instancesOf`, `effectiveSchema`). Working with a model from
TypeScript means juggling `NodeId` strings and `EdgeKind` enums.

This design adds three things on top of the existing reflective `Repository`,
without changing its core:

1. **Typed, frozen read clients** — a generated package class per published
   artifact (`Ea` for a meta-model, `MicrosoftTech` for a library) that exposes
   the artifact's entities as typed objects with real getters and navigable
   references. Read-only, because a compiled artifact never changes.
2. **A mutable authoring layer (`ModelDraft`)** — an overlay over one or more
   frozen bases, where a user creates a *model* (concrete instances) by adding
   typed entities whose reference fields point into the frozen bases. Only the
   overlay ever mutates.
3. **A storage seam (`GraphStore`)** — so a Repository's node/edge set can be
   hydrated from, and (for the mutable overlay) written back to, a source other
   than a text document: a JSON document, or a graph database.

The unifying idea, established during brainstorming: **the compiled graph is a
serialized `Repository` (nodes + edges), read-only and immutable; a model is a
separate mutable overlay layered on top of frozen bases; and where nodes/edges
come from (text, JSON, a graph DB) is orthogonal to the `Repository` API.**

---

## 2. Mental model (the invariants everything rests on)

- **Compiled artifact = serialized Repository.** `.todl` → parse → load →
  `Repository` → `toJSON` → `model.json` (`TodlDocument { nodes, edges }`), the
  serialized backing `Graph`. `fromJSON` reconstructs it. The artifact carries
  graph *data* only — derivations/invariants are re-registered on load, spans
  are authoring-only and not serialized.
- **The compiled graph is read-only and never mutates.** Meta-models and
  libraries are published, versioned, immutable artifacts.
- **The model is a mutable overlay.** It is a *different* graph that (a) is typed
  by the meta-model's concepts, (b) references the library's instances, and (c)
  holds the user's own instances. Reads resolve overlay-first then fall through
  to the bases; writes only ever touch the overlay. This is the existing
  `checkAgainst([bases], [ownSource])` split (prior art: Plexus
  `architecture-instance-model.ts`, `deriveBindings`, `ownOf`).
- **A reference across the boundary is an overlay-owned edge into a frozen
  node.** `component gw`'s `implemented-by` edge lives in the overlay; its `to`
  is `m365-copilot`, an immutable library node. Immutable target, mutable arrow.
- **Scalar vs reference is decided by a member's declared type** (the
  type-directed model, todl ≥ 0.14): a `concept`/`taxonomy`-typed field is a
  reference (edge); a primitive-typed field is a scalar (attr). The typed API
  surfaces this split directly (`field()` vs `ref()`/`refs()`; a primitive value
  vs a base entity in a constructor).

---

## 3. Architecture overview

```
                 codegen (build/publish time)
 meta-model.json ─────────────► Ea.ts          (typed read client + concept
 library.json    ─────────────► MicrosoftTech.ts   constructors)
                                   │
 runtime:                          ▼
   Ea.fromJSON(metaModelJson) ─► frozen typed client  ─┐
   MicrosoftTech.fromJSON(libJson) ─► frozen client    │  bases (immutable)
                                                        │
   ModelDraft.on(ea, [ml]) ─────► mutable overlay ◄─────┘
        │  add(ea.Component(id, {fields}))
        │  reads fall through to bases; writes stay in overlay
        ▼
   GraphStore (seam):  in-memory | graph-DB (Cypher)
        │
        ├─ commit()  → DB transaction (system of record) OR in-memory
        └─ toTodl()/toJSON()  → text/JSON interchange (export, not storage)
```

Everything below is built on the **existing** `Repository`/`Graph`, `Node
{id, tier, typeOf, attrs}`, `Edge {kind, via, from, to}`, `fromJSON`/`toJSON`,
`builder()`, `effectiveSchema`, `instancesOf`, `MetaKind`. The core engine is
unchanged; this is additive.

---

## 4. Component A — Repository read primitives (the identity map)

The foundation for every typed client. Add to `Repository` (or a thin subclass)
a memoized, id-keyed entity factory and scalar/reference accessors.

**New API on `Repository`:**

```ts
// A stable, memoized handle per id. Same id → same instance (identity map),
// so references resolve to shared handles and cycles are safe.
entity<T extends Entity>(id: NodeId): T | undefined

// Convenience accessors the generated getters call:
attr(id: NodeId, name: string): Scalar | undefined      // scalar field (attr)
ref(id: NodeId, member: string): NodeId | undefined     // single Relationship edge, via=member
refs(id: NodeId, member: string): NodeId[]              // many
referrers(id: NodeId, member?: string): NodeId[]        // reverse (uses inbound adjacency)
danglingRefs(): { from: NodeId; member: string; to: NodeId }[]  // edges whose `to` is missing
```

`Entity` is the untyped base every generated concept class extends:

```ts
interface Entity {
  readonly id: string
  readonly concept: string           // typeOf
  readonly tier: Tier
  field(name: string): Scalar | undefined
  readonly fields: ReadonlyMap<string, Scalar>
  ref(member: string): Entity | undefined
  refs(member: string): Entity[]
  referrers(member?: string): Entity[]
  type(): Entity                     // the concept, itself an Entity
  schema(): ConceptSchema
  is(conceptOrClass: string): boolean  // subtype / instanceOf aware
}
```

**Decisions:**
- Entities are **lazy id-keyed lenses**, never deep-copied POJOs — this is what
  preserves identity, sharing, reverse-navigation, and (for the overlay)
  mutation coherence. `a.ref('x') === b.ref('x')` when they point at one node.
- The API **splits `field()` from `ref()`/`refs()`**, mirroring the
  type-directed model. Consumers never see `EdgeKind`/`Direction`/`via`.
- Absence is `undefined`, never a throw. A dangling edge yields `undefined` at
  the point of navigation; `danglingRefs()` reports them in bulk.
- Reuses the existing `view(id)`/`ReactiveNode` idea, promoted to public API.

---

## 5. Component B — Frozen eager hydration (read-only bases)

Because a compiled artifact never changes, a base client can hydrate the entire
object graph **once**, eagerly, with an identity map, and freeze it — no lazy
repo lookups on the read path, references are shared instances, cycles resolve.

**Two-pass hydration:**

```ts
static fromJSON(doc: TodlDocument): <Client> {
  const byId = new Map<NodeId, EntityHandle>()
  for (const n of doc.nodes) byId.set(n.id, makeHandle(n))          // pass 1: scalars
  for (const e of doc.edges)
    if (e.kind === EdgeKind.Relationship) link(byId.get(e.from), e.via, byId.get(e.to))  // pass 2: wire refs
  for (const h of byId.values()) Object.freeze(h)                    // structurally immutable
  return new <Client>(byId /* + the underlying Graph for the raw query API */)
}
```

**What immutability buys (and the spec requires be exploited):**
- **Memoize derived queries forever** (`effectiveSchema`, subtype closures,
  `narrowerOf`) — compute once, cache on the instance, no invalidation logic.
- **`readonly` return types + `Object.freeze`** — the type system enforces what
  the graph guarantees; a write is a compile error.
- **Shareable across workers/threads** with no defensive copying.

**Eager vs lazy** is the only remaining knob and is a *size* tradeoff, not a
correctness one. Ship **eager** (ideal for reference-catalog sizes). A lazy,
still-identity-mapped variant is a future option only if a real catalog proves
it necessary; it MUST NOT be built speculatively.

---

## 6. Component C — Generated typed read clients

One generated `.ts` per published artifact: a **package class** named from the
artifact plus a **typed entity class per concept**.

**Naming:**
- Artifact id (kebab) → PascalCase package class: `microsoft-tech` →
  `MicrosoftTech`, `ea` → `Ea`.
- Concept id (kebab) → PascalCase entity class: `component` → `Component`.
- Member id (kebab) → camelCase accessor: `implemented-by` → `implementedBy`,
  `available-in` → `availableIn`.

**Package class** extends `Repository` (so the typed accessors AND the raw query
API live on one object), with one collection accessor per concept and per
taxonomy:

```ts
export class MicrosoftTech extends Repository {
  static fromJSON(doc: TodlDocument): MicrosoftTech { /* §5 hydration */ }

  get technologies(): readonly Technology[] { … }   // instancesOf('technology')
  get locations():    readonly Location[]   { … }
  get stack():        readonly Technology[] { … }   // termsOf('stack') taxonomy, grouped
}
```

**Entity class** — typed getters over §4 primitives; scalars from `attr`,
references from `ref`/`refs`:

```ts
export class Technology extends EntityBase {
  get label(): string { return this.attr('label') as string }
  get billing(): Billing | undefined { return this.entityRef('billing', Billing) }
  get availableIn(): readonly Location[] { return this.entityRefs('available-in', Location) }
}
```

**Codegen input** is entirely the meta-model graph the runtime already exposes:
- collection accessors ← `instancesOf(concept)` / `termsOf(taxonomy)`
- entity scalar getters ← `effectiveSchema(concept).fields` where the field type
  is primitive
- entity reference getters ← `effectiveSchema(concept).fields` where the field
  type is `concept`/`taxonomy`, plus `.relationships`
- entity class hierarchy (optional) ← `subtypesOf` so the handles mirror concept
  `extends`

**When generated:** at publish time, emitted next to `model.json` — the
typed-client analog of the compiled presentation. (Packaging decision: see §11.)

---

## 7. Component D — `ModelDraft` (the mutable authoring overlay)

The single mutable object. Layers over frozen bases; every write lands in the
overlay; reads fall through to bases.

```ts
class ModelDraft {
  static on(metaModel: MetaModelClient, libraries: ReadonlyClient[],
            opts: { namespace: string; metaModel?: string }): ModelDraft

  add(descriptor: InstanceDescriptor): EntityDraft   // stage an instance, return its handle
  remove(id: NodeId): void
  transact(fn: (tx: DraftTx) => void): void          // atomic batch
  commit(): void                                     // apply to the backing GraphStore
  get diagnostics(): Diagnostic[]                    // validation against the bases

  toTodl(): string                                   // export (interchange)
  toJSON(): TodlDocument                             // the OWN overlay delta only
}
```

**Layered resolution.** Node lookup checks the overlay first, then each base.
An overlay instance's `typeOf` may be a frozen meta-model concept; an overlay
edge's `to` may be a frozen library node. Resolution spans layers; only the
overlay is writable. Implementation reuses the `checkAgainst` base/own split.

**Cross-boundary + own→own references.** `add(...)` with a base entity value →
an overlay `Relationship` edge into the frozen node's id. `add(...)` referencing
a previously-added draft handle → an overlay edge within the overlay. Identical
mechanics; the `to` is just an id.

**Serialization = overlay delta + bindings.** `toJSON()` emits ONLY the overlay
(`ownOf(full, baseIds)`): the user's instances and their edges (cross-boundary
edges recorded by target id), plus a binding header (`model <id> : <metaModel>
uses <lib…>`, via `deriveBindings`). Bases are referenced by identity, never
copied in. Reopen = resolve bindings → load+freeze bases → replay overlay.

**Validation** runs the overlay against the frozen bases (the vocabulary): the
meta-model supplies the schema (valid concept? valid field? type-compatible
reference? cardinality?), the library supplies referenceable instances. Misses
are the SAME diagnostics the loader raises — `member.value-kind`,
`reference.undefined`, `cardinality.*` — reached through the API instead of
parsing text.

---

## 8. Component E — Generated typed authoring constructors

The write-side mirror of Component C. Concepts belong to their meta-model, so
constructors are **scoped to the meta-model client** and emitted as **stateless
descriptor factories** (they hold no draft state; `draft.add` performs the
mutation).

```ts
// generated on the meta-model client, from effectiveSchema('component')
component(id: string, fields: {
  label?: string
  category: Category                 // taxonomy-typed  → reference (required)
  implementedBy?: Technology         // concept-typed    → reference (optional)
  realisedBy?: Technology[]          // many reference
}): InstanceDescriptor
```

Usage (the brainstormed target):

```ts
const ea = Ea.fromJSON(metaModelJson)             // frozen base
const ml = MicrosoftTech.fromJSON(libraryJson)    // frozen base
const draft = ModelDraft.on(ea, [ml], { namespace: 'app', metaModel: 'ea' })

const copilot = draft.add(ea.component('copilot', {
  label: 'Copilot',
  category:      ea.categories.chatSurface,                     // taxonomy term (meta-model)
  implementedBy: ml.microsoftStack.technologies.m365Copilot,    // Technology (library)
}))

draft.commit()      // → GraphStore write (DB or memory)
draft.toTodl()      // → .todl export
```

**Why the library is NOT a type parameter.** A field's *type* is a meta-model
type (`Technology`, `Category`); a library merely *provides instances* of it. So
`ea.component`'s signature needs only meta-model types; any library that yields a
`Technology` is a valid value source. Libraries bind to the **draft** (for id
resolution + validation), not to the constructor's type. `[ea, ml]` on the
constructor is therefore dropped.

**Scalar vs reference in the signature.** Primitive-typed fields take primitive
values (→ attrs); concept/taxonomy-typed fields take entity values (→ edges).
`InstanceDescriptor` records `{ concept, id, scalars: Map, refs: Map<member,
id[]> }`; `draft.add` stages the node + attrs + edges accordingly. Kebab→camel
mapping as in §6. Required/cardinality that can't be expressed in the TS type is
checked at `add`/`commit`.

**Convenience alias (optional):** the draft may re-expose the meta-model's
factories bound to itself (`draft.component('copilot', {…})` ≡
`draft.add(ea.component('copilot', {…}))`). Primary form is the descriptor +
`add` (matches the brainstorm and keeps the meta-model client stateless).

---

## 9. Component F — `GraphStore` seam + graph-database backing

Put an interface between `Repository`/`Graph` and its storage — the same move as
the existing `IStorage` file seam.

```ts
interface GraphStore {
  getNode(id: NodeId): Node | undefined
  outEdges(id: NodeId): Edge[]
  inEdges(id: NodeId): Edge[]
  instancesOf(typeOf: NodeId): NodeId[]
  allNodes(): Iterable<Node>
  // mutations (overlay only):
  addNode(n: Node): void
  addEdge(e: Edge): void
  setAttr(id: NodeId, name: string, value: Scalar): void
  remove(id: NodeId): void
  commit(): void
}
```

Two implementations satisfy it:
1. **In-memory** — the current `_nodes`/`_out`/`_in`/`_byType` maps (default;
   what `fromJSON` produces).
2. **Cypher / graph DB** — reads translate to `MATCH`, mutations to a
   `CREATE/SET/MERGE/DELETE` transaction, `commit()` flushes a DB transaction,
   the `changed` signal fires on write confirmation.

The `Repository` facade is unchanged — swap what's underneath. This is the
`Project → GraphRepository → Storage` design already captured for the Cypher
instance store.

**The property-graph mapping is near-isomorphic** (why the DB is the natural home
for the mutable model layer):

| TODL | Property graph |
|---|---|
| `Node.id` | node key |
| `Node.tier` (Meta/Ontology/Instance) | node label |
| `Node.typeOf` | node label / property (or `:TypeOf` edge) |
| `Node.attrs` (scalars only) | node properties |
| `Edge.kind` | relationship type |
| `Edge.via` (member name) | relationship property |
| `from`/`to` | relationship endpoints |

Because attrs are scalars-only and all structure is edges (the type-directed
model), there are no nested blobs to flatten; and traversal queries (`closure`,
`narrowerOf`, `descendantsOf`) become variable-length path queries the DB does
*better* than in-memory adjacency.

**Layer placement:**
- **Meta-model + library** → compiled, versioned, immutable **documents**
  (`model.json`); frozen, shared. No DB.
- **Model** → the unbounded, mutable instance graph → **graph database** as its
  system of record. Cross-boundary edges = model relationships whose `to` is a
  frozen base id (resolver falls through).
- **Text (`.todl`/`model.json`)** for the model becomes an **interchange format**
  (export/import, diff, version control, hand to an agent), not the store.

---

## 10. Type & value mapping reference

**TODL → TypeScript (codegen):**
- concept → `class <Pascal> extends EntityBase`
- primitive field → scalar getter (`get label(): string`)
- concept/taxonomy field → reference getter (`get billing(): Billing | undefined`
  / `readonly Technology[]`) and constructor param typed by the referent
- cardinality `T` / `T?` / `T[]` / `T[+]` → required / optional / array / non-empty
  array (the last enforced at runtime)
- member kebab → camelCase; artifact/concept kebab → PascalCase

**Value kinds at `add` time:** primitive value → attr; entity value (base or
draft handle) → `Relationship` edge to its id; array → edge per item. Mirrors
`realizeValue` in the loader.

---

## 11. Cross-cutting decisions

- **Packaging.** Runtime primitives (§4), hydration (§5), `ModelDraft` (§7),
  `GraphStore` seam (§9) live in `@pragmatic-lab/todl`. Codegen (§6, §8) is a
  todl build/CLI step emitting per-artifact `.ts`. Generated clients are plain
  consumers of the todl runtime. (Alternative — a companion `@pragmatic-lab/
  todl-client` package — is deferred; start in-package.)
- **Read-only vs mutable is a hard boundary.** Base clients (§5/§6) expose NO
  mutation. Only `ModelDraft` mutates. Do not add mutation to base clients for
  symmetry (YAGNI).
- **One source of truth.** Typed layers are lenses over the one graph; `toJSON`
  re-serializes it. No parallel object model, no sync problem.
- **Reflective by default, typed by codegen.** Component A works with zero
  codegen; C/E are opt-in for consumers with a fixed meta-model.

---

## 12. Out of scope / non-goals

- Lazy per-entity hydration for base clients (build only if a real catalog
  proves eager too costly).
- Mutation API on base (read-only) clients.
- A separate `todl-client` npm package (start in-package).
- Concurrent multi-user editing / DB locking semantics (single-author overlay
  for v1).
- Migrating existing consumers off the raw query API (additive; they keep
  working).
- A query DSL (`.where(...)`) — iterables + typed accessors suffice for v1.

---

## 13. Open questions / risks

- **Codegen identifier collisions.** kebab→camel/Pascal can collide
  (`chat-surface` vs `chatSurface` vs `chat_surface`); the generator needs a
  deterministic de-collision rule and must reject/rename on clash.
- **Namespacing across bases.** Two bases may define same-id nodes; layered
  resolution needs the existing namespace-scoped rules to disambiguate, and the
  typed clients must not silently shadow.
- **`GraphStore` query coverage.** Every `Repository` query used by validation
  and codegen must be expressible on the Cypher store, or hydrate a slice; the
  seam interface must be proven against both back-ends with one shared test
  suite.
- **Cross-boundary dangling on base upgrade.** A saved model pins base
  ids/versions; upgrading a base could orphan a reference. Out of scope to
  *resolve*, but the load path must *detect and report* it (`reference.undefined`
  against the resolved base), not crash.
- **Descriptor vs fluent ergonomics.** Confirm `draft.add(ea.component(...))` as
  primary vs `draft.component(...)` alias during the first plan.

---

## 14. Decomposition into implementation plans

Each phase is independently testable and gets its own plan. Order reflects
dependency.

1. **Phase 1 — Read primitives + `Entity` (Component A).** `entity()` identity
   map, `attr`/`ref`/`refs`/`referrers`/`danglingRefs`, `Entity`/`EntityBase`.
   Foundation; no codegen. Testable against a hand-built `Repository`.
2. **Phase 2 — Frozen hydration + hand-written client shape (Component B).**
   Two-pass eager hydration + freeze + memoized derived queries; validate the
   handle shape with a hand-written client before generating one.
3. **Phase 3 — Read-client codegen (Component C).** Generator from a meta-model/
   library `model.json` → package class + entity classes; golden-file tests.
4. **Phase 4 — `ModelDraft` overlay (Component D).** Overlay-over-frozen-bases,
   `add`/`transact`/`commit`, layered resolution, cross-boundary refs, delta
   serialization + bindings, validation reuse. In-memory store only.
5. **Phase 5 — Authoring-constructor codegen (Component E).** `ea.component(id,
   {fields})` descriptor factories from the schema; end-to-end typed authoring
   test.
6. **Phase 6 — `GraphStore` seam (Component F, in-memory refactor).** Extract the
   seam behind the current maps with a shared conformance test suite. No DB yet.
7. **Phase 7 — Graph-DB store (Component F, Cypher).** Cypher implementation of
   `GraphStore` passing the same conformance suite; DB as the model's system of
   record; text as interchange.

Phases 1–5 deliver the full typed read+author experience on the in-memory store;
6–7 move the mutable model's system of record to a graph DB without touching the
API.
