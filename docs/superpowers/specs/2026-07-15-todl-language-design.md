# TODL Language & Runtime — Design Spec (`@pragmatic-lab/todl`)

**Status:** DRAFT — for review. Sketch fidelity: firm on architecture, marked where a
decision is still open (§11).

**Companion reference:** [`../../../legacy-todl-architecture.md`](../../../legacy-todl-architecture.md)
(how the legacy Python toolchain is built). Legacy surface it faithfully carries forward:
`legacy-development/adl/todl/spec.md` (surface) and `grammar.md` (abstract grammar).

---

## 0. Purpose & scope

TODL is a **typed substrate for authoring and reasoning over ontologies and taxonomies**,
with **AI agents as the primary consumer**. An ontology is the schema — concepts,
relationships, invariants. A taxonomy is a set of *instances* of those concepts, populated
against the ontology. TODL types both, and lets an agent traverse, query, validate, and
extend them.

`@pragmatic-lab/todl` is one TypeScript package = **language + runtime + model compiler**,
replacing the legacy Python toolchain (`legacy-development/tools/todl/`). Mural validates
its visuals against TODL's meta-models; Plexus consumes both.

**Domain-agnostic.** The language knows `concept`, `instance`, `relationship`, `invariant`
— it does *not* know what a "component", "requirement", "technology", or "capability" is.
All of that is **ontology content authored in TODL** (its own design track, separate spec).
This spec covers the **language and runtime only**.

**Non-goals (this spec):** the enterprise-architecture ontology itself; the visual DSLs
(`.view` / `.mural`, now Mural's `.mu` compiler); a reasoning engine beyond declared
structure + graph traversal + transitive closure + declarative predicates (see §4, §11).

---

## 1. Core model — the reflective typed graph

**One canonical in-memory typed graph is the hub.** Every other surface — the text
language, the builder API, the query interface, the three emitters — is a projection of it.
Compile once into the graph; project outward.

Everything is a **node**; every relationship is a typed **edge**. Three tiers, uniform, so
an agent traverses from any instance up to its concept up to the meta-kind the same way:

- **Meta tier** — the kinds TODL itself provides, fixed and built in: `primitive`,
  `concept`, `enum`, `variant`, `field`, `relationship`, `invariant`, `namespace`,
  `descriptor`.
- **Ontology tier** — a meta-model authored in TODL (e.g. enterprise-architecture): nodes
  are `concept` / `primitive` / `enum`. A concept node owns its `field` / `relationship` /
  `invariant` members as child nodes; inheritance is an `extends` edge.
- **Instance tier** — a taxonomy / model: nodes are instances typed by ontology concepts.
  Scalar fields are node attributes; ref/relationship fields are edges to other nodes.

### 1.1 Edge kinds

| Edge | From → To | Meaning |
|---|---|---|
| `type-of` | instance → concept; concept → meta-kind | **instance-of / classification.** The spine; traversing upward answers "what is this?" |
| `extends` | concept → concept; variant → variant | **is-a / subsumption.** Its transitive closure answers subtype/supertype queries (the hypernym–hyponym lattice). |
| `has-field` / `has-relationship` / `has-invariant` | concept → member | concept's declared members, as child nodes. |
| *(domain relationship)* | instance → instance | declared on a concept (e.g. an EA `implemented-by`, or a taxonomy's own `broader`). Typed by the concept's `relationship`. |
| `contains` | parent → child | **explicit** ownership/containment (a legacy wart was implicit containment inferred from `list<concept>` fields). |

Three hierarchies kept deliberately distinct — conflating the first two is a classic
ontology modeling bug:

- `extends` — subsumption between **concepts** (schema level).
- `type-of` — instantiation, **instance → concept**.
- a declared domain relationship like `broader` — a taxonomy's own term hierarchy,
  **instance → instance** (SKOS-style). *Not* `extends`.

### 1.2 Identity & references

Every node has a stable id. `$` and `@` are **reserved for Mural** (`$` = bindings, `@` =
resource resolution), so TODL uses its own referencing:

- **`&name`** — a reference to a record. Bare identifiers are enum members / literals;
  `&`-prefixed identifiers are references. The sigil is kept even though the field's declared
  type already disambiguates, because model/instance files are authored *away from* their
  concept declarations — so `&` is the only *lexical* cue, with no schema in view, that a
  token is a pointer.
- **Scope** — a reference resolves through lexical scope (namespace → imports → model). To
  point across scopes, use a **dotted qualified path**
  (`&enterprise-architecture.technologies.microsoft-teams`) as the escape hatch. This
  replaces the legacy scoped-vs-global `$slug` / `@id` split with one form + qualification.
- **`ref(x)`** — explicit form for the rare `union<…>` / `any` field where the declared type
  cannot decide reference-vs-literal.

In text a reference is a token. **After resolution it becomes an edge.** An unresolved
reference is a validation error — never a dangling string. (Fixes legacy wart #1:
name-ref vs. enum-member ambiguity collapsing to bare strings resolved by runtime guessing.)

---

## 2. Type system

Carried from the legacy type system (reference §2, `spec.md` §5–6), made graph-native. No
change to what authors can express; the change is that it compiles into the graph and is
referentially validated.

- **`primitive`** — base data type constrained by `regex` or `shape`. Built-ins: `string`,
  `text`, `integer`, `number`, `boolean`, `any`, `code`. Kebab-case enforced at the
  `identifier` primitive.
- **`concept`** — typed shape: `properties`, `relationships`, `invariants`, single
  inheritance (`extends`). A property is `name : type;`; a relationship is
  `relationship name -> target;` — with `?` / `[]` carrying cardinality (below).
- **`enum` / `variant`** — closed case-sets. `enum` desugars to
  `sealed variant : enum<enum-member>`. `variant` carries richer per-case shape. Enum tokens
  are user-facing (`EnumToken`), laxer than identifiers; may declare `aliases`.
- **Cardinality & multiplicity — TypeScript-native postfix.** `T` = required single; `T?` =
  optional single; `T[]` = list (zero or more); `T[+]` = non-empty list (one or more). `[]`
  denotes an ordered list; set semantics (uniqueness) are expressed as a constraint, not a
  separate type. One uniform rule for properties *and* relationships (bare = required single
  everywhere — drops the legacy divergent relationship default of `[*]`). Retires `list<T>`
  (→ `T[]`) and mostly retires `ref<C>` (a bare concept name in type position already denotes
  a reference; the `&` sigil marks it at the value site).
- **Generics** — `union<A,B,…>`, `enum<T>` (declaration-only), `object { … }`. Planned:
  `oneof<discriminator,[…]>`, `alias<X>`.
- **Modifiers** — `internal` (namespace-private), `sealed` (no further extension), before
  the kind keyword.
- **Namespaces** mirror the directory tree; the validator rejects namespace/location
  mismatch.

**Ontology vs. taxonomy in the type system:** ontology = `concept` / `primitive` / `enum`
declarations. Taxonomy = instance declarations (`component teams-chat { … }`) typed by a
concept via `type-of`. `extends` lives only among concepts.

---

## 3. Language surface (text)

**The C#/TS-flavored `.todl` surface is kept in spirit** (`spec.md` §2–8): namespaces,
imports, modifiers, concept/variant/enum/primitive/descriptor declarations, generics, raw
triple-quoted strings, `;`-terminated statements. Existing hand-authored records are
canonical; they are carried across by an automated one-shot migration (§9) that **preserves
meaning, not bytes** — the surface below evolves.

Surface deltas:

1. **Referencing** — `$` and `@` are reserved for Mural (bindings / resource resolution), so
   TODL references use **`&name`** (§1.2). Bare identifiers are enum members / literals;
   `&`-prefixed are references; a reference resolves to an edge. Cross-scope uses a dotted
   qualified path; `ref(x)` disambiguates `union` / `any` positions.
2. **Cardinality & multiplicity** — TypeScript-native postfix: `T` (required single), `T?`
   (optional single), `T[]` (list, zero or more), `T[+]` (non-empty list) (§2). Retires
   `list<T>` (→ `T[]`) and mostly `ref<C>` (a bare concept name in type position is a
   reference).
3. **Executable predicate/derivation sublanguage** (§4) replaces the prose-only `formal =`.
   The `invariant "…";` and `invariant { … }` forms still parse; an executable
   `predicate = …;` and `derived …` are added.
4. **Explicit containment** — marked, not inferred from `T[]`-of-concept field types (legacy
   wart #4). Exact marker is open (§11).

The **instance/model surface** (what the legacy calls `.architecture.model`) is the same
language: instance declarations of ontology concepts, e.g.

```csharp
component teams-chat { in = &m365; implemented-by = &microsoft-teams; }
```

---

## 4. Predicate / derivation sublanguage — the one genuinely new language piece

The legacy `formal =` is prose (`"∀ c ∈ components where … : c.in ∈ ….available-in"`). The
rebuild makes crisp constraints **executable**, so validation is real and derived relations
are computable. This is the intricate part of the *language* precisely because it is where
the ontology's intricacy gets expressed declaratively.

### 4.1 The formal / fuzzy boundary (design principle)

TODL formalizes the **crisp** and leaves the **fuzzy** to natural language + agent judgment.
This is deliberate: the consumer is an AI agent, so the open-ended "does this technology
*fit* this need" question is the agent's job, not a formal engine's. Trying to formalize it
(e.g. capability-coverage over an exhaustive shared vocabulary) yields a brittle,
high-maintenance approximation of judgment that is only ever as good as its tagging.

- **In the predicate sublanguage (crisp):** referential integrity (a reference resolves),
  cardinality, enum membership, containment legality, `extends`/`broader` closure,
  set coverage over a **coarse** classification/kind, quantified invariants.
- **Left as prose (fuzzy):** fine-grained fit. A requirement's meaning and a technology's
  suitability are natural-language, read by the agent.

**Technology selection is therefore three beats — formal → fuzzy → formal:**

1. **Narrow** (formal): candidates of the right coarse kind whose crisp constraints hold
   (e.g. `available-in` covers the deployment location). Cuts "all technologies" to a
   handful.
2. **Judge** (natural language / agent): the agent reads the prose requirement and each
   candidate's profile and ranks fit.
3. **Record** (formal): the chosen assignment + rationale written back as data, so the
   decision and its "why" become facts the next agent can read.

### 4.2 The expression language (shared core)

Invariants and derived members share one small, **total** (always-terminating) expression
language: traversal + closure + set algebra + quantifiers — deliberately *not*
Turing-complete. Comprehensions range over finite instance sets, closures run to a fixpoint
over the finite graph, and there is no general recursion.

**Binding.** Inside a member declared on concept `C`, `this` is the instance being
evaluated. Other instances are reached by quantifying over a concept: `t: technology` ranges
over all `technology` instances.

**Traversal.**

- forward — `this.field`, `this.relationship`; yields a value/node, or a node-set for `[]` /
  `[+]` members.
- closure — postfix `*` / `+` on a self-relationship: `this.broader*` (self + all ancestors,
  reflexive-transitive), `c.extends+` (proper supertypes, transitive). Regex-familiar.
- reverse — a relationship may declare an **inverse name**
  (`relationship in -> location inverse hosts;`), making the back-edge an ordinary forward
  traversal (`location.hosts`). For ad-hoc reverse without a declared inverse,
  `incoming(node, relationship)`.

**Sets & aggregates.** `in`, `not in`, `subset-of`, `superset-of`, `intersects`, `disjoint`,
`count(s)`, `s.empty`, `some(s)` (non-empty), `union` / `intersect` / `minus`. The absent
value is `none`.

**Booleans, comparison, quantifiers.** `&&`, `||`, `!`, `implies`; `== != < <= > >=`;
`all x: T | p`, `any x: T | p` (existential). Enum-valued fields carry `has(member)`
(`this.type.has(paas)`).

### 4.3 Executable invariants

An invariant is a boolean expression over `this`, evaluated per instance. The legacy
`formal =` prose is retained as documentation; `predicate =` is the executable form
(shorthand `invariant <bool-expr>;` for one-liners):

```csharp
invariant
{
    description = "A component's location must be offered by its implementing technology.";
    predicate   = this.implemented-by != none
                    implies this.in in this.implemented-by.available-in;
}
```

### 4.4 Derived members

A `derived` member is a read-only value/edge computed over the graph, declared alongside
fields and relationships. Set-valued derivations use a comprehension `{ x: T | predicate }`:

```csharp
concept component
{
    // …
    kind : capability;                                 // coarse classification (a field)
    derived implementable-by : technology[] =
        { t: technology | this.kind in t.provides };   // coarse-kind coverage
}
```

Derived members materialize (lazily; see §11) as **derived edges** — queryable like any
relationship but marked derived, not authored. They power capability-style queries ("what
can implement this?") without formalizing fuzzy fit: the derivation ranges over the *coarse*
kind, the agent does the fine judgment (§4.1). The **derived-dependency graph must be
acyclic** (a derived member may reference another; cycles are a validation error) — this is
what guarantees evaluation terminates.

### 4.5 Grammar sketch

```ebnf
Expr         ::= OrExpr
OrExpr       ::= AndExpr ( '||' AndExpr )*
AndExpr      ::= ImplExpr ( '&&' ImplExpr )*
ImplExpr     ::= CmpExpr ( 'implies' CmpExpr )?
CmpExpr      ::= SetExpr ( ( '==' | '!=' | '<' | '<=' | '>' | '>='
                           | 'in' | 'not' 'in' | 'subset-of' | 'superset-of'
                           | 'intersects' | 'disjoint' ) SetExpr )?
SetExpr      ::= Postfix ( ( 'union' | 'intersect' | 'minus' ) Postfix )*
Postfix      ::= Primary ( '.' Ident                 ; field / relationship
                         | ( '*' | '+' )             ; closure on prior relationship step
                         | '.' 'has' '(' Ident ')'
                         | '.' 'empty'
                         )*
Primary      ::= 'this' | 'none' | Literal | Ref
               | Quantifier | Comprehension | Call | '(' Expr ')'
Quantifier   ::= ( 'all' | 'any' ) Ident ':' ConceptRef '|' Expr
Comprehension::= '{' Ident ':' ConceptRef '|' Expr '}'
Call         ::= ( 'count' | 'some' | 'incoming' ) '(' Expr ( ',' Expr )* ')'
Ref          ::= '&' QualifiedName
```

---

## 5. Runtime capabilities / API

The package exposes the graph through a small typed API. All operate on the one canonical
model; none re-parse or re-derive independently.

```ts
// Load / build
parse(source: string, opts?): ParseResult          // text → AST → graph fragment
load(sources: SourceSet): Model                     // multi-file, cross-resolved
const b = model.builder()                           // mutation surface
  b.defineConcept(spec) / b.assertInstance(concept, id, fields)
  b.setField(node, name, value) / b.addRelationship(node, name, target)
  b.remove(node)                                    // incremental re-validation on commit

// Query (read the graph)
model.resolve(ref, kind?): Node | null
model.instancesOf(concept, opts?): Node[]           // scoped by contains-subtree
model.edges(node, rel, dir): Node[]                 // forward / reverse traversal
model.closure(node, edge): Node[]                   // transitive (extends / broader)
model.subtypesOf(concept) / model.supertypesOf(concept)
model.satisfies(node, constraint): Verdict          // shared with validation (§4)

// Reflect (read the schema)
model.concepts(): Concept[]
model.schemaOf(concept): { fields, relationships, invariants }

// Validate
model.validate(): Diagnostic[]                      // three phases (§6)

// Serialize (the three emit shapes, §7)
emit.toModel(model): unknown                        // in-process TS objects
emit.toJSON(model): TodlDocument                    // portable JSON
emit.toModules(model, target): EmittedModule[]      // legacy meta.js / compiled.model.js
```

The `satisfies(node, constraint)` evaluator is the **same code** validation uses, exposed so
queries can run constraints forward (candidate narrowing, §4.1 beat 1).

---

## 6. Validation — three phases

Machine-legible, staged, so errors surface at author time, not silently in a downstream
runtime (legacy wart #3: no referential validation). Phases run in order; a phase's failures
are reported before the next runs where the next depends on it.

1. **Syntax** — lex + parse well-formedness: tokens, brackets, `;`, kind matches a known
   production, type-specs parse, namespace matches file location.
2. **Semantic** — cross-file name resolution (every reference — `&name`, `ConceptRef`,
   `EnumRef`, `PrimitiveRef` — resolves in scope), type/cardinality checking, enum
   membership, containment legality, `extends` acyclicity and type-compatible overrides.
3. **Invariant** — executable predicates (§4.2), referential topology, derived-relation
   consistency.

**Diagnostics are structured, not strings** — an agent must act on them:

```ts
interface Diagnostic {
  code: string;                 // stable, e.g. "ref.unresolved", "cardinality.violated"
  severity: "error" | "warning";
  node?: NodeId;                // offending node
  path?: string;                // field path, e.g. "properties[3].type"
  expected?: unknown;           // what the rule wanted
  got?: unknown;                // what was found
  message: string;              // human-readable rendering
  span?: { file, line, col };   // source location when available
}
```

---

## 7. Emitters — three shapes from one core

All three project from the same compiled graph. "Compile once, project three ways."

1. **In-process TS objects** — the model itself (or a typed façade over it). An agent /
   Mural / Plexus running in the same process holds live typed nodes and queries them via §5.
2. **Portable JSON** — the graph serialized: nodes (with `type-of`), edges, attributes,
   plus resolved indexes (legacy wart #5: emit resolved indexes so consumers don't
   recompute). Interchange / storage / hand-off between tools and agents.
3. **Legacy JS modules** — `<mm>.meta.js` (class-per-concept + enum consts + registry of
   schemas/constructors/enums) and `.compiled.model.js` (flat `elements` + `flows` +
   `scenarios`), the shape the browser `ModelElement` runtime and Plexus's
   architecture-repository already load (reference §6). Emitted with **typed refs**
   (`{ref:"id"}`) rather than the legacy stringly-typed bare strings.

The exact JSON schema and how much of the legacy module shape Plexus actually wants are open
(§11) — "what shape does Plexus want?" is the real question there (reference §6).

---

## 8. Package shape

`@pragmatic-lab/todl`, TypeScript, ESM. Module layout by responsibility (each file one job,
small and focused):

```
src/
  lex/            tokenizer (port of lex.py; ~300 ln equiv)
  parse/          recursive-descent → AST (declarations vs. instances split at parse time,
                  reference §4 / wart #2)
  ast/            AST node types (data only)
  model/          the reflective typed graph — nodes, edges, tiers, identity, indexes
  builder/        mutation API (§5)
  validate/       three phases (§6): syntax / semantic / invariant + diagnostics
  predicate/      predicate + derivation sublanguage (§4): parse + evaluate; satisfies()
  query/          resolve / instancesOf / edges / closure / subtypes / reflect (§5)
  emit/
    model.ts      in-process façade
    json.ts       portable JSON
    modules.ts    legacy meta.js / compiled.model.js
  index.ts        public API surface
meta-models/      authored .todl content shipped with the package (EA, BPMN) — data, compiled
                  by the toolchain, not language built-ins
```

"Language + meta-models + model compiler" (the rebuild target): the **language/runtime** is
`src/`; the **meta-models** are authored `.todl` content bundled and compiled by it; the
**model compiler** is `load` + `validate` + `emit`.

---

## 9. Migration from the Python toolchain

- Port `lex → parse → validate → emit` to TS, one subsystem at a time, each with its own
  tests.
- The authored `.todl` meta-models (EA ~21 concepts + enums, BPMN) are migrated by an
  **automated one-shot tool** (references `$` → `&`, `list<T>` → `T[]`, `[*]` / `[1]` → `[]`
  / bare, etc.). Migration preserves **meaning**; the faithfulness test is that a migrated
  record validates to the same graph as the original. Output reviewed before commit — they
  are canonical.
- The three-phase validator and the predicate sublanguage are net-new (no Python
  equivalent).
- Emitters reproduce the legacy `meta.js` / `compiled.model.js` contract (with typed refs)
  so downstream runtimes keep working, plus the two new shapes.

---

## 10. Success criteria

- Every existing hand-authored `.todl` record parses and validates.
- A referential error (unresolved reference, cardinality violation, enum-membership miss,
  containment breach, `extends` cycle) is caught with a structured diagnostic, at author
  time.
- An agent can, in-process: load a model, ask "what is X" (type-of chain + schema + fields +
  in/out edges + closures), run a `narrow` query over a coarse kind + crisp constraints, and
  write an assignment + rationale back.
- One compiled model emits all three shapes; the legacy JS-module shape still loads in the
  existing runtime.

---

## 11. Open decisions

1. **Predicate sublanguage** — grammar specified in §4.5. Remaining nits: final operator
   precedence; whether `incoming()` stays or every reverse traversal must declare an
   `inverse` name; whether closure `*` / `+` may apply to any relationship or only `extends`
   / `broader`.
2. **Derived-relation evaluation** — lazy on query vs. materialized at compile; cache
   invalidation on builder mutation.
3. **Containment marker** — `contains` relationship kind vs. a `[contained]` field
   attribute vs. a concept-level `contains = [...]` list.
4. **Legacy emit fidelity** — how much of `meta.js` / `compiled.model.js` Plexus actually
   consumes vs. the portable-JSON shape; whether scenarios embed in the model module
   (reference wart #5) or stay a sidecar.
5. **Meta-model bootstrapping** — self-hosted `todl.todl` (TODL describing its own record
   kinds) vs. TS-native meta-kinds; how far the reflective tier goes.
6. **Coarse-kind mechanism** — is `kind` a dedicated first-class classification axis in the
   language, or just a conventional enum-typed field an ontology chooses to declare? (Leaning
   conventional — keeps the language domain-agnostic.)

---

## 12. Explicitly out of scope

- The enterprise-architecture ontology content (concepts like component / application /
  requirement / technology, and their relationships) — separate design track, on top of this.
- Fuzzy technology-fit reasoning — natural language + agent judgment, not formalized (§4.1).
- Visual DSLs (`.view` / `.mural`) — Mural's `.mu` compiler.
