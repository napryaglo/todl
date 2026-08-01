# TODL — the Typed Object Definition Language

`@pragmatic-lab/todl` is a small language and compiler for describing **typed
shapes** and the data that conforms to them. One language types an entire tower:
the meta-kinds that define what a "concept" is, the domain vocabularies written
as concepts, and the concrete models authored against those vocabularies. The
compiler loads source into a reflective typed graph, validates it into
machine-legible diagnostics, and emits portable interchange and runtime forms.

This document is the comprehensive reference: the philosophy, the reflective
tower, the compiler pipeline, the full language surface, the predicate
sub-language, the diagnostics, the compiled outputs, and the public API. It
describes the surface the current parser and validator actually enforce.

> **The compiler is the ground truth.** Where this prose disagrees with the
> diagnostics the compiler produces, the compiler wins — it is the live
> authority. A clean diagnostic list is a valid model.
>
> Older, archived notes describe a *previous* Python toolchain (`enum` /
> `variant`, `$slug` references, `list<T>` generics, YAML models). That surface
> is **not** what this compiler accepts. Ignore it when writing `.todl`; read
> this document instead.

---

## 1. Philosophy — everything is a typed record, in layers

TODL is a **typing substrate**: a language whose only job is to describe typed
shapes. Every artifact — the language's own meta-kinds, a domain vocabulary, a
concrete model — is a stack of records written in it.

```
Meta-kinds       concept · primitive · taxonomy · relationship · field ·
   │             annotation · model · package   (what a "concept" *is*)
   ▼
Meta-models      domain vocabularies, written IN TODL as concepts +
   │             taxonomies + primitives + annotations
   ▼
Models           concrete instances that conform to a meta-model, authored
                 inside a `model` block and drawing terms from libraries
```

The payoff of one language across the whole tower: the same loader, the same
graph, the same validator, and the same emitters serve the meta-model author
and the model author alike. A meta-model *is* data — a graph of concept nodes —
so tools can reflect over it (generate presentation, build a manifest, drive
completion) exactly as they reflect over instance data.

---

## 2. The reflective tower — tiers, nodes, edges

After loading, every declaration becomes a **node** in a directed typed
**graph**; every structural or domain relationship becomes a typed **edge**.
This is the runtime hub the validator and emitters walk.

### Tiers

A node lives in one of three tiers (`Tier`):

| Tier | Holds | Examples |
|------|-------|----------|
| `Meta` | the meta-kinds themselves — the type-of spine | `concept`, `primitive`, `taxonomy`, `annotation`, `model` |
| `Ontology` | meta-model declarations | a `component` concept, an `identifier` primitive, a `component-category` taxonomy, an `icon` annotation |
| `Instance` | concrete data | a `model` container and the `component` instances it carries |

A node's `typeOf` points "up" one tier: an instance's `typeOf` is its concept;
a concept's `typeOf` is the meta-kind `concept`. `MetaKind` enumerates the
ontology meta-kinds the loader stamps: `Concept`, `Primitive`, `Taxonomy`,
`Field`, `Relationship`, `Model`, `Annotation`, `Package`.

### Nodes

```ts
interface Node {
  id: NodeId;              // globally unique id (the declaration's name / path)
  tier: Tier;              // Meta | Ontology | Instance
  typeOf: NodeId;          // the concept or meta-kind this node is an instance of
  attrs: Map<string, Scalar>;  // scalar field values only (string | number | boolean)
}
```

Only **scalar** field values live in `attrs`. Everything relational — an enum
selection, a reference to another record, containment, inheritance — is an
**edge**, never an attribute.

### Edges

`EdgeKind` is the *structural* kind of an edge. Domain-relationship names are
per-ontology data, so they are not enumerated — they ride on the edge's `via`
field (the member node the edge realises) under `EdgeKind.Relationship`.

| EdgeKind | Meaning |
|----------|---------|
| `TypeOf` | node → the type it instantiates |
| `Extends` | concept → parent concept (single inheritance) |
| `Contains` | container → a record nested in its body (a `model` → its instances) |
| `HasField` / `HasRelationship` / `HasInvariant` | concept → its declared members |
| `Relationship` | instance → related instance, `via` = the relationship member |
| `Derived` | instance → a derived-member value, `via` = the member |
| `Narrower` | taxonomy hierarchy: broader term → narrower term |
| `InstanceOf` | leaf → the class it instantiates (identity instantiation) |
| `Represents` | taxonomy → the concept it is a vocabulary of |
| `Annotated` | concept \| package → an annotation-application node |

The graph keeps dual adjacency (forward `out` + reverse `in`), so reverse
traversal — "who relates to me", "what are my subtypes" — is free. `related()`
and `closure()` walk edges of a given kind and direction; a change bus
(`Graph.changed`) emits one event per mutation, backing incremental validation
and reactive façades.

### Multiplicity

`Cardinality` is the surface suffix on a field or relationship:

| Enum | Surface | Range |
|------|---------|-------|
| `One` | (none) | exactly 1 |
| `Optional` | `?` | 0..1 |
| `Many` | `[]` | 0..N |
| `NonEmpty` | `[+]` | 1..N |

---

## 3. The compiler pipeline

Source text becomes a validated, emittable graph through a fixed sequence of
phases. Each phase attaches spanned diagnostics rather than throwing, so a
partial or malformed model still yields the best graph the compiler could build.

```
sources ──► tokenize ──► parse ──► load ──► validate ──► emit
 (.todl)     tokens       AST      graph    diagnostics   TodlDocument (JSON)
                                                           <slug>.js (runtime module)
```

- **tokenize** (`lexer.ts`) — text → `Token[]`. Enforces the lexical rules
  (kebab-case identifiers, `"..."` / `"""..."""` strings, `&` references) and
  reports `syntax.unexpected-character` / `syntax.unterminated-string`. The
  sigils `@` and `$` are reserved for Mural and are hard errors here.
- **parse** (`parser.ts`) — tokens → a `NamespaceNode` AST of `Declaration`s
  (`parse/ast.ts`). Invariant predicates are captured as raw token slices and
  parsed on demand by the predicate parser. Reports
  `syntax.unexpected-token` / `syntax.expected`.
- **load** (`loader.ts`) — AST → a `Repository` (graph + typed accessors). This
  is where declarations become nodes, members become edges, references resolve,
  and the type-of / extends / contains / represents spine is wired.
- **validate** (`validate.ts`) — walks the graph and produces the semantic
  diagnostics (cardinality, target types, invariants, class rules, taxonomy
  integrity, model binding scope, annotation params). See §7.
- **emit** — projects the graph to a portable `TodlDocument` (JSON, §8.1) or a
  legacy runtime `<slug>.js` ES module (§8.2).

The whole "load + validate" round-trip is the `check` / `checkAgainst` entry
points (§9); everything else is a lower-level seam these compose.

---

## 4. Language reference

### 4.1 File shape

One `namespace` per file; every declaration lives inside it. The namespace is a
dotted, kebab-case path that by convention mirrors the file's folder path.
`import` statements come first, before any declaration, and pull another
namespace's declarations into scope so its concepts / primitives / taxonomies
are referable by bare name.

```todl
namespace acme.ea.model
{
    import acme.ea.concepts;
    import acme.ea.taxonomies;

    model acme : acme.ea.concepts { … }
}
```

### 4.2 Lexical rules

- **Identifiers**: `[a-z] [a-z0-9]* ( - [a-z0-9]+ )*` — lowercase kebab-case
  (`app-component`, `implemented-by`). No PascalCase, no `_`, no leading digit.
- **Comments**: `// line` and `/* block */`; both ignored.
- **Strings**: `"single line"`; **raw / multi-line** triple-quoted `"""…"""`
  (keeps newlines — used for `description` prose).
- **Numbers**: bare integers (`order = 1;`).
- **References**: `&name` or `&dotted.path` — the `&` sigil points at another
  record. `@` and `$` are reserved for Mural and are errors in `.todl`.
- **Terminators**: every statement ends in `;`. Blocks are `{ … }`, lists are
  `[ … ]`.

### 4.3 `primitive` — a base data type

```todl
primitive identifier : string
{
    description = "A stable, machine-friendly id.";
    regex = "[a-z][a-z0-9]*(-[a-z0-9]+)*";
}
```

`primitive <name> : <base>` optionally names a base scalar primitive (`string`,
`integer`, `boolean`). The body carries a `description` and, for string
primitives, a `regex` constraint. `string` is usable as a bare field type
without being declared.

### 4.4 `concept` — a type in the meta-model

A concept is the first-class entity authors instantiate and the compiler
validates. It carries fields, relationships, invariants, and annotations, and
supports single inheritance.

```todl
concept component
{
    description = """
        A first-class entity in the architecture — the unit that runs in a
        location. Naming is purpose-first; the technology choice lives in
        implemented-by, not in the name.
        """;

    id : identifier;
    label : label;
    category : component-category;
    implemented-by : identifier ?;

    relationship in -> location;
    relationship realised-by -> technology [];

    invariant "Component ids are globally unique within the model.";
    invariant
    {
        description = "A component names its implementing technology.";
        predicate   = this.implemented-by != none;
    }
}
```

**Fields** — `<name> : <type> <cardinality>? ;`. `<type>` is a single name: a
primitive, a taxonomy, or another concept. There is no inline object type — for
structured data, define a nested concept and reference it by name. The
cardinality suffix is one of `?` / `[]` / `[+]` (or omitted for exactly one).

**Inheritance** — `concept <name> : <parent> { … }` extends a parent, inheriting
its fields and relationships. An override may only narrow to a
type-compatible field.

**Relationships** — `relationship <name> -> <target> <cardinality>? ;`. The
`<target>` must be a concept name; a value may target the concept or any of its
subtypes. Same cardinality suffixes as fields.

**Invariants** — rules the validator enforces on instances. The prose form
(`invariant "…";`) is documentation surfaced on violation. The block form adds
a machine-checked `predicate` expression (see §5).

### 4.5 `taxonomy` — a controlled vocabulary (clabject classes)

A taxonomy *represents* one or more concepts; each `term` is a **class** of that
concept — a named subtype carrying fixed field values. A concept field typed by
the taxonomy takes one of its terms as a bare-name value.

```todl
taxonomy component-category : represents component
{
    description = "The kinds of component the architecture recognises.";

    term ai-agent  { label = "AI Agent"; }
    term database  { label = "Database"; }
    term api       { label = "API"; }
}
```

- `taxonomy <name> : represents <concept> ( , <concept> )*` — the concept(s)
  whose instances draw their class from this taxonomy.
- `term <id> { <name> = <value>; … }` — the single-concept term form, valid when
  the taxonomy represents exactly one concept.
- `<concept> <id> { … }` — the **concept-led** term form, used when a taxonomy
  represents several concepts and each term must say which concept it is a class
  of (`location azure { … }`).

An instance selects a term by bare name (`category = ai-agent;`). A `|`-composed
set is allowed where the field is a flag set (`traits = physical | managed;`).

### 4.6 `annotation` / `annotate` — typed metadata

An **annotation** is typed, author-declared metadata attached to a concept or to
the package as a whole. It is static / type-level — it carries no per-instance
data. The compiler validates it and downstream tools read it (Plexus's
presentation generator and package manifest).

Declare an annotation type like a concept, with typed params:

```todl
annotation icon     { path : string; }
annotation category { name : string; order : integer ?; }
annotation author   { name : string; email : string ?; }
```

Apply it with `annotate` — legal inside a `concept` body, a `taxonomy` body, a
taxonomy `term` body, a `class` declaration, or a `package { }` block
(annotations are type-level; a concrete instance carrying `annotate` is
`annotation.invalid-target`) — giving each param a fixed value:

```todl
concept actor
{
    annotate icon     { path = "resources/actor.svg"; }
    annotate category { name = "actors"; order = 1; }

    label : label;
}

package
{
    annotate author { name = "Acme Corp"; email = "eng@acme.io"; }
}
```

A taxonomy itself takes annotations, and so does each term (a term is a class of
its concept) — the taxonomy-level annotation decorates the taxonomy, the
term-level one decorates that term, so a taxonomy and its terms can each carry
their own icon:

    taxonomy actors : represents actor
    {
        annotate icon { path = "resources/actors.svg"; }   // the taxonomy's icon

        term internal
        {
            label = "Internal";
            annotate icon { path = "resources/internal.svg"; }   // this term's icon
        }
    }

- Each annotation applies **at most once per target**; a repeat is
  `annotation.duplicate`.
- Params are scalar (string / integer / boolean). A required param must be given
  (`cardinality.required-missing`); an undeclared param is
  `annotation.unknown-param`; an unknown annotation name is
  `reference.undefined`.
- **Well-known annotations drive presentation.** `annotate icon { path = "…"; }`
  and `annotate label { text = "…"; }` on a concept feed the generated
  presentation (a raw `icon =` / `label =` attribute, where present, still takes
  precedence). Custom annotations are queryable and bindable in author overrides.

### 4.7 `model` — the instance container

Meta-model authors write concepts / primitives / taxonomies / annotations; the
*data* (instances) is authored in a `model` block, the **sole carrier of
concrete instances**.

```todl
model acme : acme-ea uses azure-catalog
{
    component business-agent
    {
        label = "Business Agent";
        category = ai-agent;
        implemented-by = copilot;
    }

    location azure-westeurope { label = "Azure West Europe"; }
}
```

- `model <id> : <meta-model> [uses <library>, …] { … }` — the `:` names the
  bound meta-model and `uses` lists the libraries it draws terms from. Both are
  **namespace names** that must be in scope; an unbound name is
  `model.binding-undefined`.
- **A concrete instance declared at top level (outside any `model`) is
  `instance.orphan`.** An instance whose concept or class comes from a namespace
  the `model` does not bind is `constructor.out-of-scope`.
- A nested record inside a body expresses **containment** (an `EdgeKind.Contains`
  edge). `<id>` is a bare identifier or a quoted string.

### 4.8 `class` and `instanceof` — partial fixed-value definitions

`class <concept> <id> { … }` declares a **class**: a partial, fixed-value
definition of a concept. Classes are **exempt** from the `model` rule — they may
sit at top level — and are exempt from completeness checks (their leaves
complete them), but are still checked for over-cardinality and target types.

A leaf instantiates one with `instanceof`:

```todl
class component web-app { category = api; }

model acme : acme-ea
{
    component storefront instanceof web-app { label = "Storefront"; }
}
```

`instanceof X` requires `X` to exist, to be a class, and to share the leaf's
concept — otherwise `class.binding-invalid`. A leaf may not set a class-fixed
scalar field to a different value (`class.override`).

### 4.9 Edge shorthand

Connectors and steps can be written as edges: `&from <op> &to` where `<op>` is
`->` or `-->`. A trailing `{ … }` block adds attributes; otherwise end with `;`.

```todl
connector &business-agent --> &crm-api;
step &receive -> &validate;
```

### 4.10 Modifiers

`internal` (namespace-private) and `sealed` (no further extension) may prefix a
declaration (`internal concept …`, `sealed concept …`). Both are optional.

---

## 5. The predicate sub-language

An invariant's `predicate` (and any derived-member expression) is a small,
total expression language evaluated over the graph. Its AST (`predicate/ast.ts`)
is built from these node kinds and operators:

- **Atoms**: `this` (the instance under check), `none` (absence / the empty
  set), a bare name (an enum member or `&record` reference), a bound variable.
- **Member access**: `this.field`, `this.relationship` — walks attrs and edges.
- **Binary operators** (`BinaryOp`): `&&` (And), `||` (Or), `implies` (Implies),
  `==` (Eq), `!=` (Neq), `in` (In).
- **Unary** (`UnaryOp`): `!` (Not).
- **Quantifiers / comprehensions** (`QuantifierKind`): `all … in …` and
  `any … in …` over a set-valued member.

```todl
invariant
{
    description = "Every component runs in a known location.";
    predicate   = this.in != none;
}
```

The evaluator (`evaluate.ts`) exposes `evaluate` and `satisfies`; the AST is
also constructable directly via the exported builders (`member`, `all`, `any`,
`and`, `implies`, `eq`, …) for programmatic rules. When unsure of a predicate's
exact shape, write the prose invariant form and confirm behaviour in the
diagnostics.

---

## 6. Bases — composing against published meta-models and libraries

A model authored in isolation would report every reference to its meta-model as
undefined. `checkAgainst(bases, sources)` seeds the graph with already-compiled
**base** documents (published meta-models and libraries, as `TodlDocument`
JSON) before loading the sources, so a reference resolves to a base node instead
of being flagged.

Bases merge with idempotent, first-wins dedup: a node id already present is
kept, and an edge identical to one already present (kind + via + from + to) is
dropped. This lets bases that share a foundation — a library that carries its
own meta-model — compose without duplicate nodes or double-counted edges.
`checkAgainst([], sources)` is exactly `check(sources)`.

---

## 7. Diagnostics

Every diagnostic carries a stable `code` (`DiagnosticCode`), a `severity`, a
human `message`, and — for everything but whole-model checks — a source `span`,
the offending `node`, and a concept-qualified member `path`.

**Syntax phase**

- `syntax.unexpected-character` — a stray character (often a reserved `@` / `$`).
- `syntax.unterminated-string` — a string with no closing quote.
- `syntax.unexpected-token` / `syntax.expected` — malformed structure, a missing
  `;`, an out-of-place keyword.

**Cardinality**

- `cardinality.required-missing` — a required (exactly-one) member is absent.
- `cardinality.too-many` — more values than the cardinality allows.
- `cardinality.empty-not-allowed` — a `[+]` member has zero values.

**Relationships & invariants**

- `relationship.target-type` — a relationship value isn't the target concept
  (or a subtype of it).
- `invariant.failed` — an instance violates a concept invariant.

**Classes & taxonomies**

- `class.override` — a leaf overrides a class-fixed scalar field.
- `class.binding-invalid` — an `instanceof` target is unknown, isn't a class, or
  isn't the leaf's concept.
- `taxonomy.no-represented-concept` — a taxonomy names no concept it represents.
- `taxonomy.value-unresolved` — a taxonomy-typed field value isn't a term of
  that taxonomy.
- `taxonomy.term-concept-not-represented` — a term is a class of a concept the
  taxonomy doesn't represent.
- `taxonomy.term-concept-ambiguous` — a bare `term` can't be attributed to a
  single represented concept.

**Instances, references, models, annotations**

- `instance.ambiguous-field-binding` — an assignment can't be matched to a
  single field.
- `reference.undefined` — a `&reference` (or annotation name) resolves to
  nothing.
- `instance.orphan` — a concrete instance is declared outside a `model` block.
- `model.binding-undefined` — a `model`'s `: <meta-model>` or a `uses` entry
  names a namespace no loaded module provides.
- `constructor.out-of-scope` — an instance's concept or class comes from a
  namespace the enclosing `model` doesn't bind.
- `annotation.duplicate` — the same annotation is applied twice to one target.
- `annotation.unknown-param` — an `annotate` gives a param the annotation didn't
  declare.
- `annotation.invalid-target` — `annotate` appears on a concrete instance;
  annotations are type-level (concepts, taxonomies, taxonomy terms, classes, package).

Fix errors from the top down: a syntax error early in a file can cascade into
spurious later diagnostics. Re-check after each fix.

---

## 8. Compiled outputs

### 8.1 `TodlDocument` — the portable JSON form

`toJSON(model)` serialises the graph to a plain, stringifiable document;
`fromJSON(doc)` rebuilds a `Repository` from it. Enums are written by member
name (not numeric value), so the wire form is stable and human-legible. This is
the interchange / storage / hand-off shape — and the exact shape `checkAgainst`
consumes as a base.

```ts
interface TodlDocument {
  nodes: { id; tier; typeOf; attrs: Record<string, Scalar> }[];
  edges: { kind; via: string | null; from; to }[];
}
```

### 8.2 `<slug>.js` — the runtime module

`toMetaModule(model, { slug, … })` projects the ontology tier to a legacy
`<slug>.js` ES module — the shape the browser runtime (Mural / Plexus) consumes:

- `export class <Pascal> extends ModelElement` per concept, carrying a
  `static schema = { kind, fields, relationships }`.
- `export const <Pascal>` per taxonomy: an `{ slug, values, has() }` table.
- `export const <camel>` registry aggregating concept schemas, data-driven
  constructors, and taxonomy tables — the object the runtime queries to
  introspect the schema.

Options: `slug` (names the registry and `slug` field), `rootConcept`,
`runtimeImport` (the `ModelElement` import path), `registryName`.

---

## 9. Public API

The package entry (`@pragmatic-lab/todl`) exports the whole pipeline as
composable seams.

**Top-level check**

```ts
import { check, checkAgainst } from "@pragmatic-lab/todl";

const { model, diagnostics } = check(sources);              // load + validate
const r = checkAgainst(bases, sources);                     // seed bases first
```

- `check(sources: SourceFile[])` — load and validate; every diagnostic is
  spanned. Returns `{ model: Repository, diagnostics: Diagnostic[] }`.
- `checkAgainst(bases: TodlDocument[], sources)` — the same, against compiled
  bases (§6).

**Lower-level phases** — `tokenize`, `parse`, `parsePredicate`, `load`,
`validate`, `toJSON` / `fromJSON`, `toMetaModule`, `rewrite` (migration).

**The graph & model** — `Graph`, `Repository`, `Tier`, `EdgeKind`, `Direction`,
`Cardinality`, `MetaKind`, `Builder`, and the reactive layer (`ReactiveNode`,
`INotifyPropertyChanged`, `INotifyCollectionChanged`).

**Predicates** — the `Expr` AST, its builders (`member`, `all`, `any`, `and`,
`or`, `implies`, `eq`, `neq`, `isIn`, `not`, `THIS`, `NONE`) and the evaluator
(`evaluate`, `satisfies`).

**Diagnostics** — `Severity`, `DiagnosticCode`, `Diagnostic`, and the span types
`Position` / `SourceSpan` / `SourceFile`.

A language-service layer (`@pragmatic-lab/todl/language-service`) and an LSP
server (`@pragmatic-lab/todl/language-server`) build on these to provide
completion, hover, diagnostics, navigation, rename, folding, and semantic tokens
for editors.

---

## 10. Quick reference

```todl
namespace a.b.c { … }                       // one namespace per file
import a.b.d;                               // imports first, in the body

primitive id : string { description = "…"; regex = "…"; }

annotation icon { path : string; }          // typed metadata type

concept thing : parent
{
    annotate icon { path = "resources/thing.svg"; }   // decorate the concept
    description = """ … """;
    name  : label;              // exactly one
    tags  : some-taxonomy [];   // many (0..N)
    owner : identifier ?;       // optional (0..1)
    parts : part [+];           // one or more (1..N)
    relationship uses -> other [];
    invariant "…";
    invariant { description = "…"; predicate = this.owner != none; }
}

taxonomy some-taxonomy : represents thing {
    term a { label = "A"; annotate icon { path = "a.svg"; } }   // terms take annotations
}

class thing preset { tags = a; }            // partial, fixed-value; top-level ok

package { annotate author { name = "…"; } } // package-level metadata

model m : a.b.c uses lib                    // instances live in a model
{
    thing t instanceof preset { name = "T"; owner = someone; }
}
```
