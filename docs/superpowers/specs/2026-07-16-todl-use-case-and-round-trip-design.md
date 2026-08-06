# TODL Use-Case, Consumption & Round-Trip — Design Note

**Status:** 📝 Note — vision/context note, not an implementation spec. Terminal; not tracked as pending work.

Captured 2026-07-16 from a brainstorm clarifying *why* TODL exists and how it is
consumed. This is vision/architecture context, not an implementation spec — it
frames the work, the missing primitives, and the open decisions.

## The use case (Eugene's framing)

1. **TODL builds the meta-model** — the ontology: concepts, enums, fields,
   relationships, invariants. Authored by humans (the meta-model designer).
2. **An agent builds *models* against the meta-model.** The meta-model's
   definitions tell the agent what can exist and how; the agent authors instance
   models that conform.
3. **Libraries are data sources.** The technology libraries (`default`,
   `microsoft`, `aws`, …) are a catalog of real technologies / categories /
   locations / icons the agent draws on to fill a model with meaningful,
   end-user-relevant data (e.g. bind a component to a real `implemented-by`
   technology).
4. **The model compiles to an object graph in JS** so the visualization tool
   loads and displays it.
5. **Round-trip ("the whitespace"): the end-user modifies the agent-built model
   in the viz tool, and those changes propagate back into the model** —
   serialized back to TODL format.

## Guiding principle: the `Model` is the single source of truth

Everything else is a *projection* of the loaded in-memory `Model`:

```
meta-model (.todl, human)  ─┐
libraries (.todl, catalog) ─┼─► load ─► Model ◄──── agent authors/edits (builder + narrow-query)
                            ─┘            │  ▲
                                          │  │  reactive mutate (user edits in the viz)
                          display ◄───────┤  │
                          (viz walks Model)  │
                                          toTodl ──► .todl   (save / round-trip)
                                          toJSON ──► portable graph (cross a process/storage boundary; lossless)
```

The round-trip pain comes from making a *compiled display artifact* the thing
the user edits and then trying to reverse it back to TODL. Don't. Keep the
`Model` as the truth; never edit a downstream projection you then have to
un-compile.

## The compiler as a deterministic validator (the core value)

Non-deterministic producer (the agent), **deterministic verifier** (the
compiler). The meta-model is an *executable contract*: a hallucination becomes a
caught error instead of a silently-wrong diagram.

**What it catches deterministically:** missing required fields, wrong-typed
relationship targets, cardinality violations, `extends` cycles, executable
invariants. **What it cannot catch:** structurally-valid but architecturally-wrong
models (real component bound to real-but-silly technology). That is the
formal/fuzzy boundary — crisp constraints formalized and enforced; fit/quality
stays agent-or-human judgment.

**The payoff is the repair loop, not just the error.** Diagnostics are
machine-legible (`DiagnosticCode` + `node` + `path` + `message`), so:
agent emits TODL → `validate()` → structured diagnostics fed back → agent
self-corrects → re-validate. Keep the diagnostic shape machine-first.

**Same gate guards both directions.** When the user edits in the viz and it
serializes back through `toTodl`, the identical validator runs. One contract
guards agent authoring *and* human edits.

**Pre-emptive beats post-hoc.** The reflection surface (`schemaOf`,
`effectiveSchema`, `instancesOf`, enum cases) lets the agent read the schema
*before* authoring ("what does a `component` require, what are valid `category`
values"), preventing the hallucination rather than catching it after.

### Current validator gaps (found during the EA migration)

Places a hallucination slips through today — hardening targets, in priority order:

1. **Enum membership is not checked.** `category = quantum-widget` (invented) or
   `ai-agnt` (typo) becomes an unresolved placeholder and *cardinality still
   passes* — no error. The single biggest hallucination vector, unguarded.
   Highest-value fix; also cleans up the enum-value placeholder wart the
   migration exposed.
2. **Unknown concepts don't error.** `componnt foo { }` gets an empty schema and
   validates clean instead of failing "no such concept."
3. **EA invariants are prose-only.** The `formal = "∀ c ∈ …"` blocks were
   downgraded to prose (TODL's predicate language doesn't cover set-builder
   notation), so the meta-model's real rules (component location ∈ tech's
   `available-in`; category ∈ `applicable-to`) don't execute — the very
   constraints that would catch a bad component/tech pairing.

## How Plexus consumes TODL

Checked Plexus's code: the `architecture-meta-models`, `architecture-repository`,
and `technology-library` modules are **UI panel scaffolds with no data loader**
(hardcoded placeholder sections). No existing contract to match — the data side
is greenfield.

**Recommended:** Plexus imports `@pragmatic-lab/todl` (it already consumes
`@pragmatic-lab/mural` / `fresco` from Verdaccio the same way), reads
`.todl` sources through its existing IStorage / FileSystemService seam, calls
`load()` → a live `Model`, and binds panels to it via reflection. The reactive
`Model` (INotifyPropertyChanged / INotifyCollectionChanged) plugs into Mural
binding directly. No compiled JS, no build step.

Shapes, by boundary:
- **In-process package import** — best fit; live `Model`, natural round-trip.
- **Portable JSON** (`toJSON`/`fromJSON`, built) — lossless machine
  serialization for crossing a process/storage boundary.
- **Compiled `.js` module** (`.meta.js` / `.compiled.model.js`) — a
  browser-runtime compat artifact for a viewer that won't embed the runtime;
  one-way, *not* the round-trip path.

## Reading the meta-model & libraries for the end-user

Text vs. visual is a *presentation* choice over one `Model`, not a data fork.
Split by audience and by read-vs-edit:

- **End-user reading → visual, via Mural.** The reflective graph makes this
  nearly free: a concept is a node, an enum a node with case-children — render
  them with meta-model DataTemplates through the *same engine that renders
  models*. Meta-model → an interactive schema inspector; libraries → a
  filterable card palette. This is what the scaffolded Plexus panels want to be.
- **Author editing the meta-model → text editor.** TODL is canonical; editing
  the ontology as text is precise, diffable, versionable. Add a TODL grammar for
  highlighting + live `validate()` → gutter markers (the deterministic guardrail
  made visible to a human).
- **Read is cheap; visual *editing* explodes scope.** Visual-read everywhere,
  text-edit for the meta-model, reserve visual *editing* for the model/diagram
  (what users change constantly). Skip a visual ontology editor for now.

"Read the meta-model/libraries visually" and "Plexus consumes TODL" are the same
task: load into a `Model`, bind the panels via reflection.

## Missing primitives (next work, by priority for this use case)

1. **`toTodl(model): string` serializer** — the round-trip / whitespace. Contract
   = **semantic** round-trip (`load(toTodl(m))` yields the same graph), not
   textual. Sidesteps formatting/provenance; canonical output is fine when the
   agent is author + re-reader. The "inline objects → standalone records"
   migration decision helps (standalone serializes trivially).
2. **Enum-membership validation** (+ unknown-concept check) — closes the biggest
   hallucination gap; cheap; cleans up the placeholder wart.
3. **`narrow` query surface** (§5) — lets the agent search libraries
   ("technologies `available-in` azure `applicable-to` ai-agent") to fill models.
4. **Meta-model / library DataTemplates (`.mural`)** — the visual read surface.
5. **TODL text editor + live validation** in Plexus — author surface + guardrail
   window.
6. **Meta-model version in the model binding** (`: enterprise-architecture@5`) +
   a **resolver** (`(id, version)` → vendored content).
7. **Plexus built-in package manager** — registry + resolver + vendor-into-project
   + `todl.lock`; publish-time `validate()`.

The compiled-`.js`-module emitter drops to genuinely optional — only for a
viewer that won't embed the TODL runtime.

## Distribution & packaging

A meta-model is a **versioned shared dependency**, not a file you copy — because
models, libraries, and views all *validate against it*, and a change can
invalidate existing models. So distribution is dependency management for
ontologies. Same for the technology libraries (they bind the meta-model too).

### Identity + version is the linchpin

The meta-model descriptor already carries identity + version
(`meta-model enterprise-architecture { version = 5 }`). The missing half: a
model's binding must reference it by **id + version** — today `: enterprise-architecture`,
it should resolve `: enterprise-architecture@5`. Once both sides carry a version,
distribution is safe: a model pins the ontology it was authored against, and the
validator can deterministically tell you whether it still conforms when the
meta-model moves. Re-validating a model against a newer meta-model version
surfaces exactly what broke (removed enum value, new required field) — the same
guardrail, pointed at ontology evolution.

### What ships in a package: raw `.todl`, not compiled JS

The package payload is the **raw `.todl` tree + a manifest (`id`, `version`) + an
authored conventions doc** (see below). Not compiled JS. Reasons:

- The compiled `.meta.js` registry is **lossy** for what a meta-model is *for* —
  it's a schema-shape vehicle and drops/degrades the **invariants** (the
  executable predicates that make the validator a guardrail). Raw `.todl` is
  complete.
- Every consumer of a meta-model (validator, agent reflection, Plexus schema
  browser) **already runs the TODL runtime**, so "precompile to skip the parser"
  saves nothing real — there is no runtime-less consumer of an *ontology* (there
  is for *model display*, which is a different, compiled artifact).
- Raw `.todl` keeps **source == distribution**: no drift, clean semantic diffs
  between versions, and it matches `toTodl` round-trip output.
- Meta-models are small; parse-on-load is negligible.

Get the "sealed / known-good" guarantee at **publish time** (`validate()` refuses
to ship a broken meta-model), not via a compiled artifact. Optionally include a
`toJSON` snapshot as a load-accelerator / integrity seal — an optimization,
clearly derived, not the source of truth. (Compiled JS is only for a *model*
targeting a runtime-less browser viewer — the legacy path, a different package.)

### Plexus provides a built-in package manager

Plexus embeds the registry + resolver + installer itself (no external Verdaccio
to run) — `npm` semantics for ontologies, in-app. On **project creation**, the
user picks a meta-model (+ libraries) + versions; Plexus resolves and **vendors
them into the project directory** as read-only dependencies, writes a lockfile,
and the project is self-contained (offline, reproducible).

```
my-project/
  .todl-deps/                              ← vendored, read-only, resolved from the registry
    meta-models/enterprise-architecture/   (raw .todl, v5)
    libraries/{default,microsoft,aws}/
  models/                                  ← authored by agent + user (project content)
  todl.lock                                ← pins resolved (meta-model + library) versions
  CLAUDE.md / AGENTS.md                    ← agent orientation (see below)
```

The `node_modules`-vs-`src` split matters: the agent must distinguish "the fixed
rules I author *against*" (vendored deps) from "what I'm authoring" (models).
`todl.lock` makes every user who opens the project resolve identical versions.

A **shared storage backend** (the IStorage cloud/REST seam) remains the secondary
channel for teams co-authoring an evolving meta-model live (no publish cycle);
`toJSON` is the portable wire form for either channel.

### How the agent learns the meta-model — formal vs. fuzzy

The split *is* the answer, and it mirrors the formal/fuzzy boundary:

- **Schema (formal) → the agent reads/queries the meta-model itself, never a
  markdown paraphrase.** Concepts, fields, valid enum values, cardinality,
  relationships, invariants come from the vendored `.todl` directly (file access)
  or a reflection surface (`schemaOf` / `instancesOf` / enum cases — a
  `todl describe component` CLI or MCP tool). This is the *same truth the
  validator enforces*. Paraphrasing the schema into CLAUDE.md would reintroduce
  exactly the drift + hallucination the deterministic validator exists to
  eliminate — the agent would author against a stale prose picture. Don't.
- **Conventions & orientation (fuzzy) → CLAUDE.md / AGENTS.md.** The
  non-enforceable judgment: naming philosophy (purpose-first), "only these three
  relationship types," "don't reference TOGAF/ArchiMate," house style — plus
  practical orientation ("uses `enterprise-architecture@5` in `.todl-deps/`,
  author into `models/`, run `todl validate`"). The conventions doc **ships
  inside the meta-model package** (authored by the meta-model designer, versioned
  with the `.todl`, so it can't drift); project creation composes it with a small
  generated header into the project's CLAUDE.md.

### The agent authoring loop

1. **Orient** — read CLAUDE.md (conventions + where things are).
2. **Query schema** — reflect the meta-model for what's valid.
3. **Query libraries** — `narrow` the catalog for real data.
4. **Author** the model `.todl`.
5. **Validate** — `todl validate` → structured diagnostics → repair.

The validator is ground truth; steps 1–2 reduce how often it fires.

### Effort estimate — built-in package manager

**Medium**, and cheaper than "package manager" sounds: most substrate exists, and
the hard parts of a general PM (deep transitive trees, conflict resolution, a
network protocol, a per-package build toolchain) don't apply. The real cost is
Plexus UI, not the resolver.

**Already exists (why it's not a big build):** Plexus IStorage seam + project
factories + ProjectExplorerService + project dialogs; TODL `load()` / `validate()`
/ `toJSON`; `version` in the meta-model descriptor; the `: <meta-model>` binding
parse; the `test_project/` vendored layout.

**Decomposition** (most pieces are small glue):

| Piece | Size | Notes |
|---|---|---|
| Package format + manifest (`id`, `version`, `kind`, deps) | S | schema + reader/writer |
| Local registry store (`<id>/<version>/` over IStorage) | S–M | local-first; no network |
| Resolver + `todl.lock` (semver) | M | shallow graph (project → 1 meta-model + N libs; lib → 1 meta-model); no diamond conflicts |
| Install / vendor into `.todl-deps/` (read-only) | S | file copy over IStorage |
| Publish (`validate()` → write to store) | S | validate exists; near-free |
| `@version` in the binding + loader resolution | S–M | small parser tweak; project-load already loads meta+libs+model together |
| Plexus UI (create-project dropdown, package browser) | M | biggest / most open-ended chunk |

**Clean split to contain risk:** put the PM *logic* — manifest, resolver,
lockfile, version binding — in `@pragmatic-lab/todl` as a `pkg`/`resolve` module
(pure, TDD-testable, no UI); Plexus wires its IStorage + dialogs to it.

**Cheap vs. could-balloon:** cheap because local-first (no server/auth/CDN/
protocol — v1 registry = a directory + index). Defer: compatibility semantics
(keep dumb — "library declares a meta-model range"); upgrade/migration UX (pin
and defer — the validator already reports what broke); remote/shared registry (a
separate server-side effort, out of v1).

**Scoping:**
- **v1 (local, minimal)** — manifest + local store + simple resolver + lockfile +
  vendor + publish-with-validate + `@version` binding + one create-project
  dropdown. The bulk of the value; ~10-task plan, a handful of focused sessions,
  mostly glue; biggest task is the create-project UI.
- **v2 (incremental)** — package-browser panel, upgrade/migrate flow,
  remote/shared registry (the big one).

Do **not** build a remote registry or an auto-migrator in v1 — that's where PMs
get expensive, and neither is needed to prove the loop.

## Open decisions

- **Does the viz tool embed `@pragmatic-lab/todl` (live `Model`) or stay a thin
  viewer (serialized graph)?** Determines whether round-trip is "mutate the Model
  in-process" (easy) or "diff-and-apply change-sets across a boundary" (harder).
  Everything hangs off this.
- **Model edits vs. view edits.** Only *model* edits (rename, re-categorize, add
  component, rewire) round-trip to TODL. Position/layout is *view* state
  (`.view` / Mural) and must not leak into `.todl`.
- **End-user meta-model reading: inspector or graph view?** Inspector (click a
  concept → detail card) is a few templates on existing panels. Graph view
  (concepts + relationship edges, ER/UML-style) reuses the diagram/layout engine
  but is more work.
- **Agent schema-access mechanism.** Start simplest (agent reads vendored raw
  `.todl`) → graduate to a `todl describe` CLI → an MCP reflection tool, for
  token-efficiency and precision. Principle holds regardless.
- **Registry scope.** Per-machine Plexus registry vs. a shared team registry vs.
  both (local cache in front of a remote). Ties into the shared-storage channel.
