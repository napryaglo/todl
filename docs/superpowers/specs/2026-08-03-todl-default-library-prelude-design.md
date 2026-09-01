# TODL Default Library (Prelude) — Design

**Status:** ✅ Finished

**Goal:** Ship a curated set of standard TODL definitions — primitives, standard
annotations, and a universal root concept — that are implicitly in scope for every
file and project, so authors stop re-declaring the same boilerplate in every
meta-model.

**Tech Stack:** `@pragmatic-tech-ai/todl` (TypeScript, ESM). Authored in TODL itself
(`.todl`), compiled to a JSON base at package build.

---

## Problem

Only `string`, `number`, `boolean` are true compiler built-ins. Everything else
authors treat as "standard" is re-declared in every meta-model:

- Primitives: `identifier`, `label`, `slug`.
- Annotations: `icon`, `toolbox` (and the new `instance` drop-binding from the
  annotation-driven term-drop design).

The published `tech-architecture` meta-model declares all of these itself; every
future meta-model would copy them verbatim. There is also no universal supertype —
no top type tooling can assume ("every node has a label") or that queries can range
over.

## Goal / Success Criteria

- A meta-model author writes `id : identifier`, `annotate icon { … }`,
  `concept x { … }` without declaring `identifier`, `icon`, or a root type first.
- `check(sources)` and `checkAgainst(bases, sources)` resolve the standard names
  everywhere, standalone, with no caller wiring.
- Non-breaking: every existing meta-model + instance still validates.
- The library is a hand-editable `.todl` artifact, versioned with the language.

## Design

### Residence & injection

- Source: `TODL/src/stdlib/prelude.todl` — a normal TODL file, hand-editable.
- Build: compiled to `TODL/dist/stdlib/prelude.json` (a `TodlDocument`) as part of
  the package build; shipped in the published package.
- Injection: both `check` and `checkAgainst` prepend it as the implicit **first
  base**: `mergeBases([PRELUDE, ...bases])`. `mergeBases`' first-wins dedup makes
  the prelude the foundation every source and every other base composes onto.

### Bootstrapping (no self-reference)

Compiling `prelude.todl` must NOT inject the prelude into itself. Factor the
current `check`/`checkAgainst` into:

- an internal **raw** path (today's behaviour — no implicit prelude), used to
  compile `prelude.todl` at build and available internally; and
- the public `check` / `checkAgainst` that inject the prelude.

The build step (or a first-call memoized loader) runs the raw path over
`prelude.todl` to produce the `TodlDocument`, then the public functions inject it.

### Namespace & name resolution

- The prelude lives in namespace `todl`.
- Its names resolve **unqualified** everywhere — `identifier`, `icon`, `element`
  with no prefix — matching how meta-models reference these today. (This is the
  one resolution rule the loader gains: prelude member names are in global scope.)

### Collision policy — reserved names + diagnostic

- The prelude always wins (it is the first base; first-wins keeps its node).
- A source that redeclares a prelude name emits a diagnostic (new code, e.g.
  `PreludeNameRedeclared`, severity Warning): *"`<name>` is provided by the default
  library; remove the local declaration."*
- Rationale: guides existing meta-models to drop their now-redundant
  `identifier`/`icon`/`toolbox`, and prevents a user concept accidentally named
  `element` (or a divergent local `identifier`) from silently disappearing under
  first-wins. Non-breaking — it still compiles.

### Root concept `element`

- `element` is injected as the **supertype of any concept that declares no explicit
  parent**. Concepts with an explicit parent (`application : component`) inherit
  `element` transitively through their chain — so `element` tops every hierarchy
  with no diamond, and the injection happens in exactly one place (parent-less
  concepts).
- Members are **optional only** — non-breaking. Identity stays structural (the
  node id); `element` does not add a required `id` field.

### Contents (`prelude.todl`)

```todl
namespace todl
{
    // ── Standard primitives (stop redeclaring these per meta-model) ──
    primitive identifier : string { regex = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"; }
    primitive slug       : string { regex = "^[a-z0-9]+(?:-[a-z0-9]+)*$"; }
    primitive label      : string { }

    // ── Standard annotations ──
    annotation icon     { path    : string?; }
    annotation toolbox  { visible : boolean?; }
    annotation instance { concept : identifier; via : identifier?; }   // drop binding

    // ── Universal root concept — implicit supertype of every parent-less concept ──
    concept element
    {
        label       : label?;
        description : string?;
    }
}
```

## Back-compatibility

- Existing **published** meta-models were compiled standalone; their already-baked
  concepts will NOT retroactively extend `element` when reused as bases (bases are
  compiled graphs, not re-loaded sources). The root benefits newly-authored or
  republished meta-models. This is acceptable and intended.
- Existing meta-models' redundant `identifier`/`icon`/`toolbox` declarations dedup
  harmlessly under first-wins when used as bases. Re-authoring surfaces the
  `PreludeNameRedeclared` cleanup diagnostic.
- Every existing instance stays valid: `element`'s members are optional; no new
  required member is introduced anywhere.

## Affected components (implementation sketch)

- `src/stdlib/prelude.todl` — new source.
- Build wiring — compile `prelude.todl` → `dist/stdlib/prelude.json` via the raw
  check; include `stdlib/**` in the published `files`.
- `src/api.ts` — split raw vs. prelude-injecting `check`/`checkAgainst`; inject the
  prelude document as the first base.
- Loader / resolver — prelude member names resolve unqualified globally; implicit
  `element` supertype for parent-less concepts.
- Validator — `PreludeNameRedeclared` diagnostic.
- (Downstream) meta-model authoring can drop the now-standard declarations; the
  Plexus term-drop resolver reads the standard `instance` annotation.

## Open sub-points (non-blocking; resolve during planning)

1. **`instance` in the language prelude vs. Plexus convention.** `instance` is a
   drop-binding the Plexus resolver reads, not a language concern. Ship it in the
   prelude for one home for standard annotations, or keep it Plexus-level? Leaning
   prelude (one standard set), revisit if it couples the language to app semantics.
2. **Diagnostic code & severity** for redeclaration — Warning vs. Info; final code
   name.
3. **`element` member types** — `label : label?` (the primitive) vs `string?`; and
   whether `description` belongs on the universal root or is too opinionated.
