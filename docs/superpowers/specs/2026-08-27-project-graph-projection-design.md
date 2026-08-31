# TODL `projectGraph` — Annotation-Driven Display-Graph Projection

**Status:** Design / brainstorming output (Approach 3, operator-driven revision)
**Date:** 2026-08-27
**Package:** `@pragmatic-lab/todl`
**Related:** [[typed-repository-clients]] (read API this builds on), [[project_operators]] (operator declarations this reads), Fresco `NestedCompoundLayout` (first consumer), Plexus `architecture-projects` (semantic reference + eventual second consumer)

---

## 1. Motivation

A resolved TODL model is a typed graph of instances. Every diagramming
consumer — Plexus's architecture canvas today, a Fresco layout-test corpus
tomorrow — needs the same first step: collapse that instance graph into a
**display graph** of *nested nodes* and *labeled edges*, where nesting comes
from containment references and edges come from ordinary references.

Plexus already does this in three renderer-side modules
(`containment.ts`, `edge-projection.ts`, `scenario-flow.ts`). That logic is
pure, reusable, and driven by declarations that already live in TODL: the
prelude annotations `@containment` / `@has_children` for nesting, and — for
*reified edges* (the `connector` concept) — the meta-model's own `operator`
declaration.

This spec moves that projection into TODL as a single reusable capability,
`projectGraph`. It stays domain-agnostic: it never learns the name
`connector`. It learns "instances of this concept are edges" from the
`operator` declaration the meta-model already makes — `operator --> :
connector (from, to)` — which TODL parses into a first-class `Operator` node
recording the edge concept and its two endpoint members. No new annotation is
introduced. Fresco consumes `projectGraph` to generate layout fixtures;
Plexus can later retire its bespoke modules and consume the same function.

## 2. Goals / Non-Goals

**Goals**

- One TODL function: `projectGraph(repo, opts?) → DisplayGraph`.
- Nesting from existing prelude annotations (`@containment` / default `in`
  member; `@has_children`) — zero meta-model change.
- Edges from (a) ordinary non-containment references and (b) reified-edge
  entities, discovered from existing `operator` declarations — zero
  meta-model change.
- A small public read accessor for operators (`operators(repo)`), since
  operators are first-class meta-model elements with no read API yet.
- Deterministic, side-effect-free, buildable entirely on the existing
  `Repository`/`Entity` read surface.
- Output is plain data (POJO) with no coordinates — a projection, not a
  layout.

**Non-Goals (deferred)**

- **Scenario flow.** Plexus's `sequences → steps → src/dst` walk is
  domain-specific and adds ordered-flow edges but no new *layout structure*
  (nested containers + freely-crossing edges are already exercised by
  containment + reified/relationship edges). Deferred (Section 10); it would
  read the `==>` step operator the same way, plus a structural sequence walk.
  YAGNI for the layout corpus.
- **Layout / geometry.** `projectGraph` emits topology only. Sizing and
  placement belong to the consumer (Fresco's `NestedCompoundLayout`).
- **Icon / presentation resolution.** Out of scope; `toElement` /
  `projectAnnotations` cover richer per-entity data if a consumer needs it.
- **A `.plexus` project resolver.** The caller composes bases (Section 8);
  TODL still ships no manifest loader.
- **No new annotations.** Nesting and edges are read from declarations that
  already exist (`@containment`/`@has_children`, `operator`).

## 3. How reified edges are recognized (no new syntax)

TODL parses `operator --> : connector (from, to);` into an `Operator` node.
The loader already resolves each into a `ResolvedOperator`:

```ts
interface ResolvedOperator {
  glyph: string;
  concept: string;         // the edge concept, e.g. "connector"
  from: string | null;     // endpoint member name
  to: string | null;       // endpoint member name
  relationship: string | null;
}
```

The `relationship` field is the discriminator TODL already computes:

- `relationship === null` ⇒ the operator **reifies an edge entity** (`a --> b`
  mints a `connector` node with `from = a`, `to = b`). Its `concept` is a
  **reified-edge concept**; instances project as edges, not nodes.
- `relationship !== null` ⇒ a pure relationship edge that mints no node
  (irrelevant to node/edge classification here).

So `projectGraph` needs no annotation to know `connector` is an edge: it reads
the operator table. The scan already exists privately as
`operatorTable(model)` in `loader.ts` (walk `allNodes()` for
`typeOf === MetaKind.Operator`, target concept via `related(id,
EdgeKind.Targets, Direction.Out)`). This spec lifts that into a public read
accessor (Section 5) so both the loader and the projector share one source.

If a meta-model ever reifies an edge concept with **no** operator declared,
`projectGraph` treats its instances as ordinary nodes — a documented
assumption, not a silent bug. Declaring the operator is the idiomatic way to
say "this concept is an edge," and the `tech-architecture` meta-model already
does (`concepts/connector.todl`).

## 4. Output types

New module `src/project/display-graph.ts` (types only):

```ts
export interface DisplayNode
{
    readonly id: string;
    readonly label: string;         // field(labelField) ?? id
    readonly concept: string;       // the instance's concept
    readonly parent: string | null; // container node id, or null at top level
}

export interface DisplayEdge
{
    readonly from: string;
    readonly to: string;
    readonly label: string | null;  // member name, reified label, or null
    readonly kind: EdgeOrigin;      // Relationship | Reified — see enum
    readonly via: string;           // member name (Relationship) or entity id (Reified)
}

export enum EdgeOrigin
{
    Relationship = 'relationship',  // an ordinary reference member became this edge
    Reified      = 'reified',       // an operator-reified entity became this edge
}

export interface DisplayGraph
{
    readonly nodes: readonly DisplayNode[];
    readonly edges: readonly DisplayEdge[];
}
```

`kind`/`via` preserve provenance so a consumer can map an edge back to its
model origin (Plexus needs this for select/delete; Fresco ignores it). Per
project convention we use a real `enum`, never a string-literal union.

## 5. API

New module `src/project/project-graph.ts`:

```ts
export interface ProjectGraphOptions
{
    /** Restrict to these instance ids. Default: every instance in the repo. */
    instances?: Iterable<string>;
    /** Viewpoint ids for scope filtering; a node is kept iff one of its
     *  framing viewpoints is in this set. Default: no filtering. */
    scope?: Iterable<string>;
    /** Scalar field read for a node's display label. Default: 'label'. */
    labelField?: string;
}

export function projectGraph(
    repo: Repository,
    opts?: ProjectGraphOptions,
): DisplayGraph;
```

Public operator read accessor (new; `src/project/operators.ts`, or promoted
onto `Repository` — see Section 12):

```ts
/** Every operator declared in the meta-model (bases + own), resolved to its
 *  edge concept and endpoint members. Lifted from loader.ts `operatorTable`. */
export function operators(repo: Repository): readonly ResolvedOperator[];
```

Both pure, deterministic, and side-effect-free.

## 6. Algorithm

Let `repo` be a resolved `Repository` (bases + own). Reads use the
`Entity`/`Repository` surface only.

### 6.1 Role discovery (computed once, memoized per call)

- **Containment member** — a relationship member `M` on concept `C` is a
  containment channel iff `resolve(`${C}.${M}@containment`)` exists **or**
  `M === 'in'`. (Matches Plexus `isContainmentRelationship`.)
- **Container concept** — `C` is a container iff `resolve(`${C}@has_children`)`
  exists **or** `C` is the target of any containment channel in the
  meta-model. (Matches `isContainerConcept`.)
- **Reified-edge concepts** — `{ op.concept : op ∈ operators(repo), op.relationship === null }`.
  Each maps to its endpoint members `(op.from, op.to)`. (Replaces Plexus's
  hardcoded `connector`/`from`/`to`.)

Annotation params are read via a small internal helper (Section 9). Role sets
live in a per-call context, not on the repo.

### 6.2 Candidate instances

`candidates = opts.instances ?? every Instance-tier node in repo.allNodes()`.
Drop any instance whose concept is a reified-edge concept (those become edges,
not nodes) and, if `opts.scope` is set, any instance not framed by an
in-scope viewpoint (`repo.viewpointsFraming(concept)` ∩ scope ≠ ∅). The
surviving set is `placed` (a `Set<string>`), reused by edge projection so an
edge is emitted only when both endpoints are nodes.

### 6.3 Nodes and nesting

For each `id` in `placed`, emit a `DisplayNode`:

- `label = entity.field(labelField) ?? id`
- `concept = entity.concept`
- `parent = containerOf(entity)` (or `null`)

`containerOf(entity)` reproduces Plexus `containingContainerOf` — dual
channel, child-side wins:

1. **Child-side up-ref.** For the entity's first containment member with a
   non-empty ref, return that ref's id (e.g. `component.in_block → block`).
2. **Parent-side membership field.** Else, among `entity.referrers()`, return
   the first referrer that lists this entity through a *reference-typed
   forward field* whose declared type is the entity's concept (or a
   supertype) — `membershipFieldFor`. This catches `block.components :
   component[]`-style ownership.
3. Else `null`.

A parent id is honored only if it is itself in `placed`; a container filtered
out of scope yields `parent = null` for its (kept) children, so the graph
never dangles a parent link. Container concepts with no children are ordinary
leaf nodes — nesting is data-driven, not concept-driven.

### 6.4 Edges

Two sources, both gated on *both endpoints ∈ `placed`*:

- **Relationship edges.** For each placed entity `E`, each **non-containment**
  relationship member `M`, each target `T` in `E.refs(M)` with `T ∈ placed`:
  emit `{ from: E.id, to: T.id, label: M, kind: Relationship, via: M }`.
  Containment members are skipped (they projected as nesting).
- **Reified edges.** For each instance `X` of a reified-edge concept, with the
  concept's endpoint members `(fromMember, toMember)`: let `f = X.ref(fromMember)`,
  `t = X.ref(toMember)`; if both exist and ∈ `placed`, emit
  `{ from: f.id, to: t.id, label: X.field(labelField) ?? X.concept,
  kind: Reified, via: X.id }`. `X` itself is not a node; an unset endpoint
  skips that edge (not an error).

Edges are de-duplicated on the tuple `(from, via, to)` — the analog of Plexus
`edgeKey` — so repeated projection is idempotent.

### 6.5 Determinism

Node and edge output arrays are sorted: nodes by `id`; edges by
`(from, via, to)`. Given the same repo and options the function returns
byte-identical results across runs and platforms (required for the Fresco
SVG-snapshot tests).

## 7. Error handling

`projectGraph` is total on well-formed input. Operator well-formedness
(endpoint members exist and are references) is already enforced by the
loader's `validateOperators`, so the projector trusts the operator table and
adds no operator errors of its own. It throws `ProjectGraphError` (new, in
`display-graph.ts`) only on:

- An `instances` id in `opts` that does not resolve.

Missing endpoints on an individual reified-edge *instance* (a connector with
an unset `from`) are **not** errors — that edge is silently skipped, matching
Plexus. Dangling references are the compiler's concern, not the projector's.

## 8. Loading / base composition (caller responsibility)

`projectGraph` takes a resolved `Repository`; it does not load sources.
Consumers compose bases exactly as `checkAgainst` does — this spec adds no
resolver. The Fresco generator will:

1. Recursively compile the base chain (prelude → `tech-architecture`
   meta-model → `microsoft` library) to `TodlDocument`s via `check` /
   `checkAgainst` + `toJSON`.
2. `checkAgainst(baseDocs, projectSources)` → the resolved `Repository`.
3. `projectGraph(repo)` → `DisplayGraph`.

A compiled-artifact fast path (`FrozenRepository.fromJSON(doc)`) works
identically since `FrozenRepository extends Repository`.

## 9. Annotation-read helper

Reading annotation params today means `related(id, EdgeKind.Annotated,
Direction.Out)` + `resolve` + `attrs` — awkward and repeated. This effort
adds one internal helper in `src/project/annotation-read.ts`:

```ts
/** Params of annotation `name` applied to `targetId`, or undefined if the
 *  annotation (or a subtype of it) is not applied. Polymorphic: an applied
 *  sub-annotation satisfies a query for its base. */
export function annotationOn(
    repo: Repository,
    targetId: string,
    name: string,
): ReadonlyMap<string, Scalar> | undefined;
```

Internal to the projection module for now (kept off the public `Repository`
surface to limit blast radius); promotable later. Presence-only checks
(`@containment`, `@has_children`) test `annotationOn(...) !== undefined`.

## 10. Deferred: scenario flow

When scenario-driven fixtures are wanted, project the `scenario` structure
the same way — read the `==>` step operator via `operators(repo)` for the
step edges, plus a structural walk of `sequences`/`steps` for ordering. No
new annotation; same operator-reading path. Not built now; recorded so the
extension point is deliberate.

## 11. Consumer: Fresco layout corpus (context, not built here)

`projectGraph` exists to feed the Tier-2 corpus harness. The end-to-end
flow, specified in its own plan:

```
plexus_tests/<project>  --(TODL compile + projectGraph)-->  DisplayGraph
                        --(map)-->  Fresco-Graph JSON (committed corpus)
Fresco test  --(load JSON, no TODL dep)-->  Graph + NestedCompoundLayout
             --> invariants + quality metrics + SVG snapshot
```

The generator is an offline dev script (TODL as devDependency); Fresco's
*test* path reads only committed JSON. `DisplayNode.parent` maps to
`Node.ParentId`; `DisplayEdge {from,to,label}` maps to `Graph.AddEdge`;
`concept`/`kind`/`via` are dropped at the JSON boundary. That mapping and the
Fresco-side asserts get their own design (out of scope for this TODL API).

## 12. File plan

**TODL (new / changed) — no `.todl` source or meta-model edits**

- `src/project/operators.ts` — public `operators(repo)` accessor, lifting the
  scan from `loader.ts` `operatorTable`; export the `ResolvedOperator` shape
  as a public `OperatorInfo` type. `loader.ts` then reuses this to avoid two
  copies. (Alternative: add `Repository.operators()` in `model.ts`; decide at
  plan time. Either way, one shared scan.)
- `src/project/display-graph.ts` — `DisplayGraph`/`DisplayNode`/`DisplayEdge`
  types, `EdgeOrigin` enum, `ProjectGraphError`.
- `src/project/annotation-read.ts` — `annotationOn` helper.
- `src/project/project-graph.ts` — `projectGraph` + `ProjectGraphOptions`.
- `src/project/tests/*.test.ts` — unit tests (Section 13).
- package root — export `projectGraph`, `operators`, the display types, and
  `EdgeOrigin`.

## 13. Testing

Unit tests (TODL, `src/project/tests/`), each compiling a tiny inline
meta-model + model via `check`/`checkAgainst`:

- **nesting-default-in** — `component --in--> location` yields
  `parent = location`.
- **nesting-annotated** — `@containment` on a non-`in` member (mirroring
  `in_block`) nests correctly; a component with neither ref is top-level.
- **nesting-membership-field** — parent-side forward field
  (`block.components : component[]`) yields the child's `parent` when the
  child has no up-ref; child-side wins when both exist.
- **container-detection** — `@has_children` makes an otherwise childless
  concept a valid container; a container instance with no children is a leaf
  node.
- **relationship-edges** — a non-containment ref projects as a labeled edge;
  a containment ref does **not**.
- **reified-edge-from-operator** — a concept with `operator _ : C (from, to)`
  (relationship null) is detected as a reified edge: an instance projects as a
  `Reified` edge and is absent from `nodes`; unset endpoint → skipped, not
  thrown; label falls back to concept name, and to `labelField` when set.
- **relationship-operator-not-reified** — an operator with `relationship !== null`
  does **not** turn its concept's instances into edges (guards the
  discriminator).
- **scope-filter** — `opts.scope` drops out-of-frame nodes and their edges;
  a child of an out-of-scope container gets `parent = null`, never a dangling
  id.
- **operators-accessor** — `operators(repo)` returns each declared operator
  with the right concept + endpoint members (bases included).
- **determinism** — two calls return deep-equal, sorted output.
- **errors** — an unknown `instances` id throws `ProjectGraphError`.

A **corpus smoke** test compiles one real `plexus_tests` project
(`test_hubspoke_project`) end-to-end and asserts the projected graph is
non-empty with at least one nested node and one cross-container edge — the
bridge to the Fresco corpus work.
