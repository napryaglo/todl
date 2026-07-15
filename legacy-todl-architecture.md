# Legacy TODL — Architecture Reference

Reference notes on how the **legacy** TODL toolchain (in
`legacy-development/`) is built, written to inform the rebuild of TODL as a
TypeScript package.

**Target for the rebuild (confirmed 2026-07-13):** `@pragmatic-lab/todl`, a
TypeScript package = **TODL language + meta-models + model compiler**. Mural
validates its visuals against TODL's meta-models; Plexus consumes both. The
legacy Python toolchain is migrated to TS, not kept in Python or shelled out
to. The visual DSLs (`.view` / `.mural`) are **not** TODL's concern — Mural's
own `.mu` compiler supersedes the legacy `view_compile` / `library_compile`.

---

## 1. The core idea: everything is a typed *record*, in layers

TODL is a **typing substrate** — a small language whose only job is to
describe *typed shapes* — and the entire ADL is a stack of records written in
it:

```
TODL substrate        ← the language itself: what a "concept", "enum", "primitive" is
   │  (adl/todl/)
   ▼
Meta-models           ← domain vocabularies, written IN TODL as concepts + enums
   │  (adl/meta-models/enterprise-architecture, bpmn)
   ▼
Models                ← instances that conform to a meta-model
   │  (.architecture.model, .bpmn.model)
   ▼
Views + Libraries     ← the visual layer (.view / .mural) — now Mural's job, out of TODL scope
```

The self-describing part: `adl/todl/todl.todl` declares TODL's own **record
kinds** (`concept`, `variant`, `enum`, `primitive`, and the three descriptors
`meta-model` / `visual-language` / `typed-object-language`). Meta-models,
Mural, and project descriptors all *are* TODL records — one language types the
whole tower.

The C#/TS-flavored `.todl` textual surface **is implemented** (the `spec.md`
DRAFT banner is stale). Models are authored in that surface, not YAML.

---

## 2. The type system (what a TS reimplementation must cover)

- **`primitive`** — a base data type constrained by a `regex` or a `shape`.
  e.g. `primitive identifier : string { regex = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"; }`.
  Kebab-case is enforced at the primitive level.
- **`concept`** — a typed shape: fields, relationships, invariants, single
  inheritance (`concept component : parent`). A field is
  `name : type-spec [cardinality]`. Relationships use a syntactic arrow:
  `relationship in -> location [1]`.
- **`enum` / `variant`** — closed case-sets. `enum` is sugar for
  `sealed variant : enum<enum-member>` (label + description per case);
  `variant` lets each case carry a richer shape (e.g. BPMN `task-types` with a
  `symbol`). Enums may declare `aliases = [...]` treated as equivalent.
- **Generics**: `list<T>`, `union<A,B>`, `ref<C>`, `enum<T>` (declaration-only),
  inline `object { … }`. Planned but unbuilt: `oneof<discriminator,[…]>`,
  `alias<X>`.
- **Cardinality**: postfix `[1]` / `[0..1]` / `[*]` / `[1..*]`; property default
  `[1]`, relationship default `[*]`; elided when default.
- **Name references**: `$slug` is the unambiguous "point at another record"
  form (`in = $m365`, `connector $a -> $b`). A bare identifier in value
  position is an enum member; `$`-prefixed is an instance ref. Matches Mural's
  `.view` `$id` convention. (Note: models also use `@id` for model-id refs —
  see the lexer `AT` token.)
- **Enum value composition**: `type = cloud | paas` — `|` is flag-OR, both
  present. Qualified form `location-type.cloud` also allowed.
- **Invariants**: prose today (`invariant "ids are globally unique.";`) with a
  `formal =` field carrying the intended predicate
  (`∀ c ∈ components …`). Executable invariants are explicit future work.
- **Namespaces mirror the directory tree**
  (`adl.meta-models.enterprise-architecture.concepts`); the validator rejects
  any mismatch between declared namespace and file location.
- **Modifiers**: `internal` (namespace-private), `sealed` (no further
  extension), before the kind keyword (C#-style).
- **Built-in primitives**: `string`, `text`, `integer`, `number`, `boolean`,
  `any`, `code`.

Concrete: a `component` concept declares `id`, `label`, `category` (an enum),
`implemented-by` (optional tech binding), relationships `in -> location` and
`realised-by -> technology`, plus invariants. A model then writes
`component teams-chat { in = $m365; implemented-by = $microsoft-teams; }`,
validated against that concept.

---

## 3. The compiler pipeline

Everything is `lex → parse → validate → emit`, with **two distinct emit
targets** and an orchestrator. All strict-mode: first error halts, reported
with line/col.

| Stage | Python file | Role |
|---|---|---|
| Lex | `tools/todl/lex.py` (~361 ln) | Tokenizer. 21 `TokenKind`s, 21 keywords. Kebab `IDENT`, PascalCase `CLASS_NAME`, raw triple-quoted strings (common-indent stripped), multi-char punctuation (`-->`/`==>`/`~~>` app-connector arrows, `..`, `->`), `$`/`@` prefixes. |
| Parse | `tools/todl/parse.py` (~1100 ln) | Recursive descent → AST. Dispatches declarations (concept/variant/enum/primitive/record/descriptor) vs. authored meta-instances. |
| AST | `tools/todl/ast_nodes.py` (~406 ln) | Dataclasses only, no logic. |
| Validate | `tools/todl/validate_ast.py` (~500 ln) | Well-formedness against the spec. Also legacy `validate.py` for the old YAML form. |
| Meta-load | `tools/todl/meta_loader.py` (~260 ln) | Loads a meta-model into a `MetaModel` summary (concept kinds, per-kind fields, containment, enum values+aliases) that model/library compile consult. |
| Emit (meta) | `tools/todl/js_emit.py` (~400 ln) | Meta-model → `<mm>.meta.js`. |
| Emit (model) | `tools/todl/model_compile.py` (~600 ln) | `.architecture.model` → `.compiled.model.js`. |
| Orchestrate | `toolchain/build_js.py` (~400 ln) | Drives the whole build from `<project>.proj.yaml`. |

**Orchestration** (`build_js.py`): reads `<project>.proj.yaml` → compile
meta-models → libraries → models → views → figures → write
`viewer-manifest.json` → mirror to `shell/manifest.json` (browser runtime
ingests it).

---

## 4. The AST model (two families of node)

The key distinction the reimplementation should make **explicit at parse
time** (legacy defers it to validation):

- **Type declarations** — `Concept`, `Enum`, `Variant`, `Primitive`,
  `Descriptor`. Live in meta-models, become `meta.js`.
- **Authored instances** — `MetaInstance` (`component business-agent { … }`),
  `MetaArrow` (`connector $a -> $b`, `step`), `ApplicationConnectorEdge`
  (`-->` integration / `==>` replacement / `~~>` runtime-dependency). Live in
  models, become `elements` / `flows`.

`MetaInstance` is currently overloaded for both authored model elements *and*
meta-concepts, with kind resolution deferred — a wart (see §7).

---

## 5. Compilation semantics

- **Flattening**: nested instances flatten into one `elements` dict; `in`
  (containment/location) is inherited from the parent; a parent's
  `list<child>` field (e.g. `block.components`) is auto-populated from nested
  instances.
- **Name-ref rendering**: `$id` (NameRef) and bare `ident` (IdentRef) both
  render as plain strings; the runtime re-infers which is which by context.
- **Connectors from three sources**, all normalized into `flows`: scenario
  `step`s, a top-level `connectors` block, and the `application-connectors`
  block (operator → derived type).
- **Scenarios**: `scenario { sequences:[ { steps:[ step a -> b ] } ] }` →
  nested JS object tree, plus a `scenarios.json` sidecar for the manifest.

---

## 6. The emit contract (the seam that matters for the rebuild)

The runtime consumer is a `ModelElement` base class (dict-backed, reactive
bindings) plus the emitted registry. Compiled models are **pure data +
constructor calls**; nothing validates references at compile time.

**`<mm>.meta.js`** — one class per concept + enum consts + a registry:

```js
import { ModelElement } from "todl-runtime/model-element.js";

export class Component extends ModelElement {
  static schema = {
    kind: "component",
    fields: {
      id:               { type: "identifier", resolves: "name-ref" },
      label:            { type: "label" },
      category:         { type: "component-category" },
      "implemented-by": { type: "identifier", cardinality: "0..1", resolves: "name-ref" },
    },
    relationships: {
      in:            { target: "location",   cardinality: "*" },
      "realised-by": { target: "technology", cardinality: "*" },
    },
  };
}

export const ComponentCategory = { slug: "component-category", values: { … }, has(v, m) { … } };

export const enterpriseArchitecture = {
  schemas:      { component: Component.schema, … },
  constructors: { component: data => { const o = new Component(); if (data) for (const [k,v] of Object.entries(data)) o.set(k,v); return o; }, … },
  enums:        { "component-category": ComponentCategory, … },
};
```

**`.compiled.model.js`** — imports that registry, builds a flat element table
+ flows + scenarios:

```js
import { enterpriseArchitecture as meta } from ".../enterprise-architecture.meta.js";
const elements = {};
elements["business-agent"] = meta.constructors.component({
  id: "business-agent", in: "power-platform", label: "AI Agent",
  category: "ai-agent", "implemented-by": "copilot-agent",
  slots: [ { id: "prod", label: "Production", environment: "pp-prod" } ],
});
const flows = [ { kind: "connector", from: "business-agent", to: "agent-orchestrator", type: "enabled-by", source: "explicit" }, … ];
const scenarios = [ { id: "conversational", sequences: [ { title: "…", "entry-point": "business-user", steps: [ { src, dst } ] } ] } ];
export const model = { meta, elements, categories, flows, scenarios, get(id), getCategory(id) };
```

**In the new stack this is exactly what Plexus's architecture-repository
loads.** So the redesign's real question is *"what shape does Plexus want?"* —
`elements` / `flows` / `scenarios` + the schema registry is the starting
point, not gospel.

---

## 7. Design warts → lessons for the TS reimplementation

1. **Name-ref vs. enum-member ambiguity.** Both collapse to bare strings; the
   runtime guesses by context. In TS, emit them distinctly (`{ref:"id"}` vs a
   value) so resolution is typed, not inferred.
2. **Split the overloaded `MetaInstance`** into authored-instance vs.
   meta-concept at parse time; don't defer kind resolution to validation.
3. **No referential validation.** The validator never checks that `$x`
   resolves or that a scenario's steps reference real elements. Add a
   three-phase pipeline: **syntax → semantic (cross-file resolution) →
   invariant (topology/referential)**, so errors surface at author time, not
   silently in the browser.
4. **Make containment explicit.** Today it's inferred from `list<concept>`
   field types with no marker; enum aliases resolve at bind time. Both should
   be explicit and early.
5. **Emit resolved indexes** into `meta.js` (e.g. technologies-by-availability)
   so bind/validate don't recompute; consider embedding scenarios in the model
   module instead of a coupled sidecar.
6. Minor: library path handling is a hacky string-prefix rewrite; no source
   maps; the manifest is mirrored/clobbered on each build.

**Net architecture:** a small typed-record language whose *type declarations*
compile to a schema+constructor registry, and whose *model instances* compile
to a flat element/flow/scenario data module against that registry. Clean
staging, but weak on referential integrity and leaning on stringly-typed
runtime resolution — the two things the TS rebuild should fix.

---

## 8. Key legacy file map

```
legacy-development/
├── adl/
│   ├── todl/                 # surface language: spec.md, grammar.md, todl.todl, concepts/
│   ├── meta-models/
│   │   ├── enterprise-architecture/   # concepts/*.todl (~21), enums/*.todl (~17), meta-model.todl
│   │   └── bpmn/
│   └── dist/<mm>.meta.js     # emitted meta-models
├── tools/todl/               # lex, parse, ast_nodes, validate_ast, meta_loader, js_emit, model_compile (Python)
├── toolchain/build_js.py     # orchestrator (reads <project>.proj.yaml)
├── pilot_project/            # worked example: 7 models + views; output/js/ compiled
└── todl-runtime/             # ModelElement base + reactive bindings (browser)
```

Canonical surface examples live in `adl/todl/spec.md` §11 (primitive, enum,
variant, concept, meta-model descriptor).
