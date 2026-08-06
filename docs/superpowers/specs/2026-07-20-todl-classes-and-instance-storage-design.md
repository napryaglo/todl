# TODL Classes + Per-Project Instance Storage — Design Capture

**Date:** 2026-07-20
**Status:** ⛔ Subsumed — folded into the 2026-08-06 typed-repository-clients & authoring design (which supersedes the Cypher instance-store idea). Terminal; no separate work pending.
Model (#1) design complete pending final sign-off on §3–§6; Storage/Query (#2)
only partially brainstormed. **No implementation started.**

---

## Origin

User need: *classes* in the architecture model. Example — `teams-chat` is a
**class**; a model may contain 5 **instances** (deployments) of it. Not
expressible in TODL today: the reflective tower's `typeOf` climbs exactly one
rung (instance → concept), leaving no room for `teams-chat` to be both an
instance-of-`component` **and** a type-for-its-deployments at once (a "clabject"
in multi-level-modeling terms).

Related threads: the ontology-model validation finding (taxonomies-as-Ontology-
vocabulary vs the `category`-concept-instances-as-repository pattern); the
SP-Tax1 taxonomy kind (2026-07-19).

---

## Decisions (from brainstorming Q&A)

1. **Class semantics** — shared definition + own context (clabject / template).
   A class is a genuine component *and* a template its deployments inherit.
2. **Override rule** — class values are **fixed**. A leaf fills only fields the
   class left unset; contradicting a fixed value is a validation error.
3. **Chaining** — **one level only**. Leaf instances are leaves; they cannot
   themselves be classes.
4. **Storage scope** — a query adapter over leaf instances. v1: in-memory store
   embedded in Plexus, persisted to disk between sessions.
5. **Query language** — Cypher-like graph-traversal DSL.
6. **Sequencing** — model → storage → query. Storage is **local to a project**,
   and a project is bound to **one specific ontology**.
7. **GraphRepository layer** — sits between project and storage, translating
   graph queries into the storage's record-level API.

---

## Sub-project decomposition

- **#1 TODL — class/instance model.** Foundation. A language + runtime change in
  the `@pragmatic-lab/todl` repo.
- **#2 Plexus — per-project instance store + Cypher-like query.** Consumer. App
  subsystem; gets its own Plexus spec at its turn.

**Dependency:** #2 queries the leaf instances, classes, and relationships that
#1 defines, so #1 lands first.

---

## Sub-project #1 — TODL class/instance model (Approach A)

### Approaches considered

- **A (chosen) — `InstanceOf` relation, both endpoints at Instance-tier.**
  Smallest change; keeps `teams-chat` a first-class component; satisfies "one
  level" and "class values fixed" naturally; the tower is untouched.
- **B — promote the class to an Ontology-tier subtype of the concept.** Clean
  tower semantics, but the class stops being a placeable/relatable component, and
  "fixed values" would need value-defaults in a schema; every catalog entry
  becomes a meta-model edit. *Rejected.*
- **C — true clabject: leaf `typeOf` points directly at the class (class stays
  Instance-tier).** Most literal, but breaks the tower invariant that an
  instance's `typeOf` resolves to an Ontology node; large blast radius across
  `resolve`/`schemaOf`/`instancesOf`/`validate`/emit. "One level only" doesn't
  justify the cost. *Rejected.*

### §1 Representation

- New `EdgeKind.InstanceOf`, from leaf → class.
- Both endpoints stay **Instance-tier**; both keep `typeOf = <concept>`
  (e.g. `component`). Class and deployments are all genuine components.
- Tower untouched — `typeOf` still climbs one rung to the concept. `InstanceOf`
  is a domain edge alongside `Relationship` / `Contains`.
- A node is a **class** iff it carries an explicit class marker (a node attr).
  Explicit, not emergent — a class may be *partial* (legally omits fields
  deployments fill), and the validator must know up front to relax completeness
  on it.

### §2 Syntax

```
class component teams-chat {
    realised-by = teams
    category    = conversational-interface
}

component chat-hq instanceof teams-chat {
    in = hq
}
```

- `class` modifier = partial template, values fixed.
- `instanceof <class>` lays the `InstanceOf` edge; body carries fill-ins only.
- **Open/adjustable:** leaf may drop the redundant concept keyword and infer the
  concept from the class; final keyword names (`class` / `instanceof`).

### §3 Effective definition (merge)

- effective(leaf) = class's fixed fields/relationships overlaid with the leaf's
  own fill-ins.
- Class values are **not copied** into the leaf — they resolve on read by
  following the `InstanceOf` edge. Each leaf record stays small (own fill-ins +
  one edge); a class change does not rewrite every deployment.

### §4 Validation

1. **No-contradiction** — a leaf setting a class-fixed field or single-valued
   relationship to a *different* value → error; the *same* value → redundant,
   allowed.
2. **Completeness-on-effective** — the merged class+leaf must satisfy the
   concept's schema (required fields, cardinalities). The class alone is exempt
   from completeness (partial template), but every value it *does* set must
   type-check.
3. **Binding sanity** — `instanceof X` requires X marked `class` and sharing the
   leaf's concept; X must exist.

### §5 Repository queries (TODL)

- `isClass(id)`, `classOf(leaf)`, `instancesOfClass(class)`,
  `effectiveFields(leaf)`, `effectiveRelationships(leaf)`.
- `instancesOf(concept)` still returns classes **and** leaves (all are instances
  of the concept); callers filter via `isClass` when they want only templates or
  only deployments.

### §6 Emit / persistence handoff

- `toJSON` serializes edges and node attrs generically → `InstanceOf` + the
  `class` marker ride along with no format change. This JSON **is** the on-disk
  shape the Plexus store persists.
- `js-module` (ontology tier only) is untouched.

**Status:** design complete, pending final user sign-off on §3–§6.

---

## Sub-project #2 — Plexus per-project instance store + query

### Layering

**Project** (bound to one ontology / compiled TODL meta-model)
→ **GraphRepository** (speaks graph: nodes, edges, traversal; translates a query
into primitive fetch/write ops)
→ **Storage** (record-level API it understands: get/put node, adjacency by
edge-kind; v1 in-memory + disk).

Cypher never reaches Storage — GraphRepository plans it down to primitives,
keeping the query language independent of the backend (mirrors the existing
`IStorage` philosophy, one level up). In v1 GraphRepository likely *wraps* a TODL
graph.

### Query language

- Cypher-like graph-traversal DSL over the TODL graph: nodes = instances, edges
  carry the relationship name in `via`, a node's "label" = its class
  (`InstanceOf` target) or concept (`typeOf`).
- Example: `MATCH (d)-[:in]->(l:location) WHERE d.class = "teams-chat" RETURN d, l`.

### Storage v1

- In-memory, disk-persisted between sessions, per-project, backend-swappable.
- Consumes the `toJSON` shape emitted by #1.

### Naming

- TODL `Repository` = in-memory graph facade (queries). Plexus `GraphRepository`
  = persistence-facing translator. Distinct layers; keep separate.

### Open items (resolve when speccing #2)

- Cypher subset for v1 (node match + property filter + relationship hops +
  `RETURN`; variable-length paths? aggregation? ordering?).
- Query result / projection shape (instance sets vs rows vs subgraphs — viz needs).
- Storage primitive API surface (node/edge CRUD, adjacency, id lookup).
- GraphRepository query planning / translation.
- Persistence format + round-trip (reuse `toJSON` / `fromJSON`?).
- Integration with existing Plexus Projects, `IStorage` seam, meta-model project type.

**Status:** partially brainstormed. To be extracted into its own Plexus spec.

---

## Cross-references

- Ontology-model validation finding — taxonomy-as-Ontology-vocabulary vs
  concept-instances-as-repository. The class/instance pattern is structurally the
  same "definition + things that point at it" shape.
- SP-Tax1 taxonomy kind (`docs/superpowers/specs/2026-07-19-todl-taxonomy-kind-design.md`).

---

## Update 2026-07-20 — taxonomy values are classes (Case 1 chosen)

**Decision.** Value-bearing taxonomy terms become first-class **classes**
(Instance-tier, fixed values, `Narrower` hierarchy). One `class` primitive, two
relations over it: **`instanceof`** (identity — a leaf *is* its class) and named
**classifying relations** (dimensions — a node *has* category X). Both inherit
the target's fixed values via the §3 effective-definition merge.

**Reframe.** A **taxonomy becomes a concept whose instances are class-terms.**
`component-category` = concept; `conversational-interface` = a class instance of
it that owns its `icon`. This:

- vindicates the user's original ontology model ("taxonomies are repositories of
  instances of concepts") — now the literal design;
- **retires the SP-Tax1 taxonomy MetaKind** (Ontology-tier terms, shipped
  2026-07-19) and the **separate `category` icon-binding concept** (merged into
  the term-class);
- requires re-migrating the 17 EA taxonomies + the `category` entries.

**Why Case 1 (worked on `m365-copilot`).** Its `applicable-to` is multi-valued
and `billing` is nested, so classification must stay a *relation*, not identity.
Case 2 ("classification IS `instanceof`") is refuted by exactly this technology —
`applicable-to` forces multi-`instanceof` (violates one-class-per-leaf) and the
four nested `billing` dimensions have no `instanceof` expression. Case 3 (keep
separate, fix wiring) leaves the term-vs-`category` duplication in place.

**Dataless enums stay cheap.** A term with no body is a degenerate class
(label-only) — no separate `enum` construct required.

> **SUPERSEDED same day.** The user corrected this: a **taxonomy is its own
> first-class entity, NOT a subtype of `concept`**. Concepts are the ontology
> bricks (they define entities + relations); a concept *references* a taxonomy,
> and that reference adds **implicit relations** to the concept(s) the taxonomy
> represents. The `taxonomy extends concept` framing below is kept only for
> history. Corrected model pending (mechanic of "represents" / implicit relation
> still being pinned).

**Resolved authoring surface (2026-07-20).** `taxonomy` **extends** `concept` at
the meta level — a taxonomy *is* a concept, so it declares a schema (fields) AND
its own closed, hierarchical set of instances inline. **`term` is an alias for
`class`** (the in-taxonomy spelling of the same Instance-tier primitive).

Consequence: the taxonomy's schema **absorbs the former `category` concept** —
`component-category` becomes the concept owning `icon : string`, and each term is
a class fixing it; the standalone `category` node is deleted.

```
taxonomy component-category {                 // taxonomy extends concept: schema + closed class-set
    icon : string;                            // absorbs the former `category` concept
    term conversational-interface { icon = "resources/conversational-interface.svg"; }
    term orchestration-engine     { icon = "resources/orchestration-engine.svg"; }
}
taxonomy billing-model {                      // no custom fields; built-in label/description only
    term m365-copilot-usl  { label = "M365 Copilot USL";  description = "…"; }
}

class component teams-chat { realised-by = microsoft-teams; category = conversational-interface; }

technology m365-copilot {
    applicable-to = [conversational-interface, orchestration-engine];  // classifying -> category terms
    billing       = { per-seat = m365-copilot-usl; };                  // classifying -> billing term
}
```

Two shapes of the one `class` primitive: an **open** class of a plain concept
(`class component teams-chat`, ad-hoc `instanceof` leaves) and a **closed**
taxonomy shipping its canonical class-set inline (`term` per member, with
`Narrower` hierarchy). Meta tier: `Concept`; `Taxonomy extends Concept`; `class`
as an Instance-tier role/marker; `Primitive` / `Field` / `Relationship`.

Scope the taxonomy re-migration (17 EA taxonomies + `category` entries) when
speccing #1.

### Corrected model (2026-07-20) — taxonomy is first-class

Supersedes the two blocks above. A **taxonomy is its own first-class entity** —
not a concept, not a subtype of one.

- **Concepts** are the ontology bricks — they define entities and relations.
  `category` **survives as a concept** (`label`, `icon`), reversing the "dissolve
  category" idea above; the icon lives on `category` and each term fixes it.
- **A taxonomy represents exactly one concept** and curates a hierarchical set of
  **terms that are classes OF that concept** — the same Instance-tier `class`
  primitive as `teams-chat`, carrying the concept's fixed fields.
- **A field typed by a taxonomy** is a classifying relation to a term (referenced
  by qualified id `taxonomy.term`) that also induces an **implicit relation** from
  the holder to the taxonomy's represented concept.

Author surface (user's sketch, normalized):

```
concept category { label : string; icon : string; }        // brick — survives

taxonomy technology-categories : extends category {         // represents `category`
    term web-portal { label = "Web"; icon = "…"; }          // a class OF category
}

technology web-application {
    applicable-to = [technology-categories.web-portal];     // classify + implicit technology → category
}
```

Resolved:
- **`represents` is mandatory** — every taxonomy represents exactly one concept.
  `billing-model` was the apparent exception only because its concept is
  *missing*: it should represent a **`billing`** concept the ontology currently
  lacks (`concept billing { label; description }`; terms `m365-copilot-usl`,
  `azure-consumption` are classes of it). A taxonomy that can't name a represented
  concept is a **lint** (incomplete ontology), not an exception.

Open:
- Keyword: `: extends` (already TODL concept-inheritance) vs `: represents`.
- Self-loop case: when holder concept == represented concept the implicit
  relation is a no-op; the sketch sidesteps it by representing `category`.
