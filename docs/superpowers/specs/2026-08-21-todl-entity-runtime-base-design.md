# TODL Entity Runtime Base (`@pragmatic-lab/todl-runtime` + emitter retarget) — Design

**Status:** Draft for review
**Date:** 2026-08-21
**Repos touched:** new `todl-runtime` package, Mural (moves `Observable` out), TODL (emitter + tests), Plexus (dependency bump, follow-on)

## Goal

Give TODL-generated concept classes a real, bindable base so a diagram node
that is an instance of a generated concept can be **data-bound** and
**`DataTemplate`-dispatched** by mural — the foundation for an author writing,
in markup:

```
DataTemplate [ DataType = Location ] { TextBlock [ Text = $label ] }
```

Concretely: replace the phantom `ModelElement` base that the js-module emitter
targets with mural's `Observable`, relocated into a new standalone
`@pragmatic-lab/todl-runtime` package so a generated entity and mural's own
`MuralBase` share **one** `Observable` class identity — the thing mural's
binding and `DataTemplate` dispatch key on.

## Motivation (context — most of it is downstream, not built here)

A larger effort wants diagram nodes to be typed, per-concept model objects. For
the `DataTemplate [ DataType = Location ]` line to resolve, `Location` must be a
real class, a node must be an *instance* of it, and `$label` must be bindable.
A real model can hold **millions** of domain objects, so a heavyweight
dependency-property object per node is prohibitive — hence the two-tier rule:
the millions stay as plain data in the TODL graph, and only the **bounded,
realized** set of nodes shown on a diagram get instantiated as these classes.

The Observable/MuralBase split
([Mural/docs/.../2026-08-21-observable-muralbase-split-design.md](../../../../Mural/docs/superpowers/specs/2026-08-21-observable-muralbase-split-design.md))
already delivered `Observable`: a minimal name/setter `INotifyPropertyChanged`
with zero dependency-property overhead, which mural's binding and `DataTemplate`
dispatch now accept as a first-class source. This spec makes TODL's generated
entities extend that exact class.

## Background: the current state

- **The emitter targets a phantom.** [TODL/src/emit/js-module.ts](../../src/emit/js-module.ts)
  emits `export class <Pascal> extends ModelElement` importing
  `{ ModelElement } from "todl-runtime/model-element.js"`
  ([js-module.ts:52,87](../../src/emit/js-module.ts#L87)). Neither
  `ModelElement` nor `todl-runtime` exists anywhere — it is a placeholder
  carried over from the legacy Python `js_emit.py` contract. Today's class is a
  pure schema holder: `static schema = { kind, fields, relationships }` and
  **no instance state, no accessors** ("thin schema vehicles, no typed
  getters").
- **`Observable` lives in mural.** [Mural/src/runtime/observable.ts](../../../../Mural/src/runtime/observable.ts):
  a `private _listeners?: Map<string, PropertyChangeCallback[]>`, virtual
  `AddPropertyChangedListener(name, cb)` / `RemovePropertyChangedListener`, and
  protected `RaisePropertyChanged(name, old, new)` that subclass setters call.
  Its only dependency is the `PropertyChangeCallback` type
  (`(owner: Observable, name, old, new) => void`). `MuralBase extends
  Observable`; binding + `DataTemplate` dispatch gate on `instanceof
  Observable`.
- **Dependency landscape.** mural and TODL are independent siblings — neither
  depends on the other as an npm package; only Plexus depends on both (mural
  `^0.19.2`, todl `^0.32.0`). So a shared `Observable` identity cannot live
  *inside* mural if TODL-generated code is to extend it without mural pulling
  TODL's compiler or TODL depending on mural.

## Design

### The layering decision

`Observable` is a neutral primitive — not a mural concept, not a TODL concept.
It becomes the shared foundation both frameworks build on:

```
@pragmatic-lab/todl-runtime   — Observable (name/setter INotifyPropertyChanged)
        ▲                                   ▲
   mural (MuralBase extends Observable)   TODL-generated `class Location extends Observable`
```

mural depends on `@pragmatic-lab/todl-runtime`; TODL's *generated output*
depends on it too. mural does **not** depend on the `@pragmatic-lab/todl`
compiler package, and `todl-runtime` depends on nothing — so there is no cycle
and mural's dependency footprint grows by ~40 lines, not by TODL's compiler.

### `@pragmatic-lab/todl-runtime` — the package

A new standalone TS package (its own directory, mirroring Mural/Fresco/TODL —
`package.json`, `tsconfig`, Verdaccio `publishConfig` + `.npmrc`, `tsc` build to
`dist` + `.d.ts`, `prepublishOnly` clean+build). Initial version `0.1.0`.

It owns exactly:
- `Observable` — moved **verbatim** from mural (behavior identical).
- `PropertyChangeCallback` — the `(owner: Observable, name, old, new) => void`
  listener type `Observable.RaisePropertyChanged` fires (moved with it, since it
  references `Observable`).

Public API (`@pragmatic-lab/todl-runtime` barrel): `Observable`,
`PropertyChangeCallback`. Nothing else in v1.

### mural — relocate, re-export, keep working

`Observable`'s class body moves to `todl-runtime`. To avoid touching mural's
many internal `from './observable.js'` import sites, mural's
`src/runtime/observable.ts` becomes a **re-export barrel**:

```ts
export { Observable, type PropertyChangeCallback } from '@pragmatic-lab/todl-runtime'
```

- `MuralBase extends Observable` is unchanged (imports through the barrel).
- `effective-value.ts` re-exports `PropertyChangeCallback` (so Plexus's
  `import { PropertyChangeCallback } from '@pragmatic-lab/mural/runtime'` keeps
  resolving) and keeps its own `InternalPropertyChangeCallback` (MuralBase/EVD
  internal — stays in mural).
- `src/runtime/index.ts` still `export { Observable }` — now from the barrel.
- mural adds `@pragmatic-lab/todl-runtime` to `dependencies`.

Consumer-visible change: **none**. `Observable` and `PropertyChangeCallback`
remain importable from `@pragmatic-lab/mural/runtime`, and it is the *same class
object* as `@pragmatic-lab/todl-runtime`'s — which is exactly what lets mural's
`instanceof Observable` recognize a TODL entity.

### The emitter retarget

[js-module.ts](../../src/emit/js-module.ts) changes so each concept class
extends `Observable` and exposes one bindable accessor per field, while keeping
the `static schema` the registry queries.

- **Import + base.** `DEFAULT_RUNTIME_IMPORT` becomes `@pragmatic-lab/todl-runtime`
  (still overridable via `runtimeImport`); emit `import { Observable } from
  "@pragmatic-lab/todl-runtime";` and `export class <Pascal> extends Observable`.
- **Per-field accessors.** For every field in the concept's schema, emit a
  private backing field + getter + change-guarded setter:
  ```js
  #label;
  get label() { return this.#label; }
  set label(v) { const o = this.#label; if (o === v) return; this.#label = v; this.RaisePropertyChanged("label", o, v); }
  ```
  Applied uniformly to **every** field, primitive or reference. The emitter does
  **not** resolve references — `parent : location?` gets the same getter/setter
  and simply holds whatever is assigned (an id, or a realized instance).
  Reference resolution / realization is downstream (Out of Scope).
- **Many-valued members** → a plain array backing field (getter/setter the same
  way). mural's binding already observes array leaves via its `observe_array`
  path, so no `ObservableCollection` (and thus no mural dependency) is needed in
  the runtime.
- **Hydration.** Emit a `constructor(init)` that assigns each known field
  through its setter from a plain data object:
  ```js
  constructor(init = {}) {
    super();
    if ("label" in init) this.label = init.label;
    // …one guarded assignment per field…
  }
  ```
  Init assignments fire `RaisePropertyChanged`, but no listeners are attached at
  construction, so they are harmless — and a realized node gets its values in
  one shot.
- **`static schema`, enums, taxonomy tables, the registry** — unchanged. The
  registry still aggregates schemas and drives concept→class lookup.

### Data flow — a generated entity in mural

1. A realized diagram node is `new Location({ id, label, parent })`. It is an
   `Observable` (via `todl-runtime`), the same class mural imports.
2. `ContentControl.Content = thatNode`; `DataTemplate [ DataType = Location ]`
   matches because `value.constructor === Location`.
3. `TextBlock [ Text = $label ]` inside the template binds: mural's binding sees
   `node instanceof Observable` (not a `MuralBase`), reads `node.label` via the
   getter, subscribes with `node.AddPropertyChangedListener("label", cb)`.
4. A later `node.label = "Azure 2"` runs the setter → `RaisePropertyChanged` →
   the binding callback → the `TextBlock` updates. Two-way writes go back through
   the setter.

## Error handling & edge cases

- **Field named like a JS reserved word / `constructor`** — the emitter already
  quotes/sanitizes keys (`jsKey`); accessor names reuse that sanitization, and a
  field literally named `constructor` is rejected at emit with a clear error
  rather than shadowing the ctor.
- **Equal-value set** — the setter's `o === v` guard fires no notification
  (matches `Observable` semantics elsewhere).
- **Unset field read** — returns the backing field's value, `undefined` until
  assigned (the concept's declared default, when the schema carries one, is
  applied in the constructor).
- **Reference held as id vs instance** — intentionally untyped in v1: the
  accessor holds whatever the realization layer assigns. No resolution, no
  validation here.
- **`RaisePropertyChanged` is `protected`** — generated JS calls it on `this`
  from setters; that is legal (JS has no visibility enforcement, and it is the
  same class hierarchy in TS terms).

## Testing

- **`todl-runtime`**: port mural's `Observable` unit tests
  (`observable.test.ts`) into the new package — notify-by-name on setter change,
  equal-value guard, lazy `_listeners`, remove-stops-delivery — proving the
  moved class behaves identically. Tests live in a `tests/` subfolder next to
  the source.
- **mural parity**: the full mural suite stays green after the relocation
  (re-export barrel means zero behavioral change); `Observable`/`MuralBase`
  identical. `instanceof Observable` still true for `MuralBase`/`Visual`.
- **emitter** ([js-module.test.ts](../../src/emit/tests/js-module.test.ts)):
  update the existing `ModelElement` assertions to `Observable` +
  `@pragmatic-lab/todl-runtime`; add assertions that a concept emits a private
  field + getter + guarded setter calling `RaisePropertyChanged`, a
  `constructor(init)` assigning fields, and that `static schema` is preserved.
- **cross-identity** (the load-bearing one): a test that a class emitted with
  `extends Observable` is `instanceof` the *same* `Observable` mural consumes —
  i.e. importing `Observable` from `@pragmatic-lab/mural/runtime` and from
  `@pragmatic-lab/todl-runtime` yields one class. (Lives in whichever package
  can import both; realistically Plexus, or a focused test in mural after the
  dep lands.)
- **live smoke** (optional, via the Plexus e2e harness): instantiate a generated
  concept, bind a `TextBlock.Text` to a field, assert push on setter change.

## Migration & rollout

Ordered so each step leaves a publishable, green artifact:

1. **Create `@pragmatic-lab/todl-runtime`**: scaffold the package, move
   `Observable` + `PropertyChangeCallback` in verbatim, port the unit tests,
   build, **publish `0.1.0` to Verdaccio** (user-gated).
2. **mural**: add the `todl-runtime` dependency; replace `observable.ts` with the
   re-export barrel; re-export `PropertyChangeCallback` from `effective-value.ts`;
   run the parity suite green; bump a **minor** version; **publish** (user-gated).
3. **TODL**: retarget the emitter + update its tests; run the TODL suite green;
   bump; **publish** (user-gated).
4. **Plexus**: bump mural + (transitively) `todl-runtime`; typecheck + suite +
   e2e green.

Backward compatibility: no serialized format change; no public API removed
(`Observable`/`PropertyChangeCallback` still exported from
`@pragmatic-lab/mural/runtime`). Existing generated modules that referenced
`ModelElement` never ran (phantom), so nothing regresses.

## Global constraints

- Publish `@pragmatic-lab/todl-runtime`, `@pragmatic-lab/mural`, and
  `@pragmatic-lab/todl` **only** to the local Verdaccio registry
  (`http://localhost:4873`), never public npm, and **only** when the user asks.
  Commit/push only when the user asks; branch first if on a default branch.
- A fixed set of named string values is a real TypeScript `enum`, never a
  string-literal union.
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- `todl-runtime` depends on **nothing**; mural depends on `todl-runtime` but NOT
  on the `@pragmatic-lab/todl` compiler; TODL does not depend on mural.
- `DataType` stays a real class `Function`; dispatch keys on `value.constructor`.

## Out of scope (downstream specs)

- **Reference resolution / realization**: turning `parent`-as-id into a resolved
  `Location` instance; the factory that decides which graph nodes get realized
  as `Observable` instances and wires their references.
- **The `DataTemplate [ DataType = <concept> ]` authoring surface** and the
  concept-discriminator template selector.
- **Containment + container nodes** (the node-model split, `ItemsPresenter`
  child host, drag-reparent, persistence).
- **Typed accessors / richer runtime**: enum-typed fields, validation,
  relationship collections as first-class observable lists, a schema-driven
  generic entity for non-realized objects.
