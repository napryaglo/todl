# TODL Use-Case, Consumption & Round-Trip — Design Note

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

The compiled-`.js`-module emitter drops to genuinely optional — only for a
viewer that won't embed the TODL runtime.

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
