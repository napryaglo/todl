# IconSource member-annotation — design

**Date:** 2026-08-15
**Status:** Approved (brainstorming)
**Repos:** TODL (`@pragmatic-lab/todl`), Plexus (consumer)

## Motivation

A concept instance drawn on the canvas needs an icon. Today the winner is
decided by a Plexus heuristic in `iconEntityKey`: a referenced term that
carries an icon outranks the entity's own type, and among several
icon-bearing referenced terms the winner is chosen by *propagation
direction* (out-degree) with schema order as the tiebreak. This is
implicit — the meta-model author cannot say "a component's icon should come
from its `implementedBy` technology, and only then from its category."

We add a declarative, author-controlled fallback: an `iconSource`
annotation applied to a concept's **relationship members**, carrying a
numeric `order`. The author states, per relation, where the icon may come
from and in what priority, when the concept defines no icon of its own.

Relationship members cannot be annotated in TODL today (the parser closes a
`relationship` with `;` and has no member body). So this design has an
enabling half — a general TODL capability to annotate relationship
members — and a specific half — the `iconSource` prelude annotation plus its
Plexus consumption.

## Non-goals

- Annotating **fields** (only relationship members get a body here).
- Inline object construction / operator definitions (deferred to a separate
  spec — the user's item #2).
- Migrating existing meta-model `.todl` files to declare `iconSource`. The
  fallback (below) keeps every current icon working untouched; authors add
  `iconSource` when they want it.
- Inherited-relationship resolution across supertypes (documented v1 edge —
  see Part C).

## Part A — TODL: annotate relationship members (enabling capability)

Relationship members gain an **optional body** holding `annotate`
statements, the same block form concepts, taxonomies, and terms already
use. A member with no body still closes with `;` — fully backward
compatible.

### Syntax

```todl
concept component {
  relationship implementedBy -> technology {
    annotate iconSource { order = 1; }
  }
  relationship categorisedAs -> category {
    annotate iconSource { order = 2; }
  }
  relationship linkedTo -> component;          // no body, unchanged
}
```

The body may hold any number of `annotate` applications (not just
`iconSource`) — the capability is general. Only `annotate` statements are
legal inside a member body; anything else is a parse error.

### AST — `src/parse/ast.ts`

`RelationshipDecl` gains an `annotations` array (defaults to empty for
bodyless members):

```ts
export interface RelationshipDecl {
  name: string;
  targets: string[];
  cardinality: Cardinality;
  annotations: AnnotationApplication[];   // NEW — empty when the member has no body
  nameSpan?: SourceSpan;
  targetSpans?: SourceSpan[];
}
```

### Parser — `src/parse/parser.ts` `parseRelationship` (~712-730)

Today the method ends: `parseCardinality()` → `expect(Semicolon)` → return.
Change the tail so that after cardinality it accepts **either** `;` **or** a
`{ … }` body of `annotate` applications:

```ts
const cardinality = this.parseCardinality();
const annotations: AnnotationApplication[] = [];
if (this.match(TokenKind.LBrace)) {
  while (!this.check(TokenKind.RBrace)) {
    if (this.checkKeyword("annotate")) {
      annotations.push(this.parseAnnotationApplication(this.startToken()));
    } else {
      throw this.error('only "annotate" statements are allowed in a relationship body');
    }
  }
  this.expect(TokenKind.RBrace);
} else {
  this.expect(TokenKind.Semicolon);
}
return { name: nameTok.value, targets, cardinality, annotations,
         nameSpan: tokenSpan(nameTok, this.uri), targetSpans };
```

`parseAnnotationApplication(startToken)` already exists and is used for
concept-level `annotate` (parser.ts:671) — reused verbatim.

### Loader — `src/parse/loader.ts` (applications pass, ~465-467)

The member node already exists after Pass 2 (`addConceptRelationship`
stages it as `${concept}.${name}`, Tier.Ontology, typeOf=Relationship). In
the applications pass, the concept branch currently stages only concept-level
annotations:

```ts
if (decl.kind === DeclKind.Concept) {
  fourth.setNamespace(ns);
  stageApplications(fourth, model, decl.name, decl.annotations, seenApps, diagnostics);
  // NEW: member-level annotations, keyed by the member node id.
  for (const rel of decl.relationships) {
    if (rel.annotations.length > 0)
      stageApplications(fourth, model, `${decl.name}.${rel.name}`, rel.annotations, seenApps, diagnostics);
  }
}
```

`stageApplications` is target-agnostic — it creates `${target}@${Ann}`,
adds the `Annotated` edge, and validates each assignment against the
annotation's declared params via `realizeValue`. No new builder method is
needed. The application node for the example above is
`component.implementedBy@iconSource` with attr `order = 1`.

No loader rejection needs relaxing: the concrete-instance guard
(`stageInstanceAnnotations`, loader.ts:686-694) is instance-specific and
members never hit it. Applying an **undeclared** annotation, or a bad param
value, is already diagnosed by the existing annotation validation reused
here.

### Reflection

`repo.resolve('${concept}.${member}@iconSource')?.attrs.get('order')`
returns the number — the same `@`-suffix resolution `iconEntityKey` uses
for `@icon`. `projectAnnotations(model, '${concept}.${member}')` also
surfaces it. No change to these APIs.

**No emitter change:** TODL's `.todl` emitter (`emit/todl.ts`) serializes
model *instances*, not concept schemas — concept/relationship declarations
are authored source and are never re-emitted by TODL. So member annotations
have no round-trip path to maintain here.

## Part B — TODL: the `iconSource` prelude annotation

One line added to `src/stdlib/prelude.todl`, beside the other well-known
tool keys:

```todl
annotation iconSource { order : number; }
```

- `order : number` is **required** (no `?`) — the whole point is a defined
  priority. `number` is a built-in type (`resolver.ts` BUILTIN_TYPES), so no
  new primitive.
- **Naming:** lowercase `iconSource`, matching the prelude convention that
  the tool-switched keys (`icon`/`label`/`toolbox`/`instance`) are lowercase
  by deliberate exception, while user-declared annotations are PascalCase.

## Part C — Plexus: `iconEntityKey` rework

`iconEntityKey`
(`src/renderer/src/modules/architecture-projects/services/arch-icon.ts`)
gains a declarative front path and keeps today's heuristic as the fallback.
The Element API's presentation resolver already calls `iconEntityKey`, so it
inherits this with no change.

### Resolution algorithm

```
iconEntityKey(repo, entity):
  hasIcon(id) := repo.resolve(`${id}@icon`)?.attrs.get('path') is a non-empty string   // unchanged

  # collect iconSource-annotated members of this concept, with their order
  sources := for each rel in entity.schema().relationships:
               order = repo.resolve(`${entity.concept}.${rel.name}@iconSource`)?.attrs.get('order')
               keep { member: rel.name, order, index } when typeof order === 'number'

  if sources is non-empty:                       # concept opts into declarative resolution
      own = entity.type()?.id ?? entity.concept
      if hasIcon(own): return own                # 1. own icon always wins
      for s in sources sorted by (order asc, then schema index asc):
          for target in entity.refs(s.member):
              if hasIcon(target.id): return target.id   # 2. first ordered source bearing an icon
      return undefined                           # 3. declared but none resolved → default glyph
  else:
      return legacyIconEntityKey(repo, entity)    # today's body, unchanged
```

- **Own icon first** matches the user's framing ("where the icon comes from
  when the component defines no icon of its own"): a concept that *does*
  carry its own `@icon` uses it; `iconSource` is strictly the fallback.
- **`legacyIconEntityKey`** is the current function body verbatim
  (referenced-term-first candidate collection → propagation-direction
  ranking → own fallback), extracted into a private helper. A concept with
  **no** `iconSource` member behaves byte-for-byte as it does today —
  zero migration, zero regression.
- **Edge (documented, v1):** a relationship inherited from a supertype has
  its member node at `${supertype}.${name}`, so
  `${entity.concept}.${name}@iconSource` won't resolve it. v1 reads
  `iconSource` from the entity's own concept only. Extending to walk
  supertypes is a follow-up if needed.

`element-presentation.ts` is unchanged — it already delegates to
`iconEntityKey`.

## Cross-repo & versioning

1. TODL: Parts A + B, publish **`@pragmatic-lab/todl` 0.26.0** to local
   Verdaccio (localhost:4873).
2. Plexus: bump the todl dependency to `^0.26.0`, rework `iconEntityKey`
   (Part C).

Meta-model `.todl` files are not migrated here; authors add `iconSource` on
the relations they want after 0.26.0 ships. Until then the fallback path
draws exactly today's icons.

## Testing

### TODL

- **Parse:** a `relationship name -> T { annotate iconSource { order = 1; } }`
  parses; `RelationshipDecl.annotations` carries the application. A bodyless
  `relationship name -> T;` parses with `annotations: []`. A non-`annotate`
  statement inside a member body is a parse error.
- **Load:** the member application node `${concept}.${member}@iconSource`
  exists with attr `order` = the number; resolvable via
  `repo.resolve(...)` and surfaced by `projectAnnotations`.
- **Validation:** an undeclared annotation on a member is diagnosed; a
  wrong-typed `order` value is diagnosed (reuses existing annotation
  validation).
- **Prelude:** `iconSource` is declared with a required `order : number`.

### Plexus

- **Own-first:** a concept that has its own `@icon` and `iconSource`
  members returns the own key.
- **Ordered pick:** no own icon; `implementedBy` (order 1) and
  `categorisedAs` (order 2) both bear icons → returns the `implementedBy`
  target; if only the order-2 target bears an icon → returns that.
- **Declared-but-none:** `iconSource` declared, no target (and no own) bears
  an icon → `undefined` (default glyph).
- **Legacy untouched:** a concept with no `iconSource` returns exactly what
  the current heuristic returns (existing `arch-icon` tests still pass).

## Files changed

**TODL**
- `src/parse/ast.ts` — `RelationshipDecl.annotations`.
- `src/parse/parser.ts` — `parseRelationship` member body.
- `src/parse/loader.ts` — stage member annotations in the applications pass.
- `src/stdlib/prelude.todl` — `annotation iconSource { order : number; }`.
- Tests under the matching `tests/` subfolders.

**Plexus**
- `src/renderer/src/modules/architecture-projects/services/arch-icon.ts` —
  `iconEntityKey` rework + extracted `legacyIconEntityKey`.
- `package.json` — todl `^0.26.0`.
- Tests under `.../services/tests/`.

## Backward compatibility

- Bodyless relationships parse and load unchanged (`annotations: []`).
- No concept declares `iconSource` until an author adds it → every existing
  icon resolves through the untouched legacy path.
- Prelude gains one annotation; no existing declaration changes.
