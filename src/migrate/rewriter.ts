/**
 * Legacy → new-surface rewriter (design spec §9). A pure string→string
 * transform over one legacy `.todl` / `.architecture.model` source, applying
 * only the mechanical token swaps the parser cannot absorb on its own:
 *
 *   1. `@ref` / `&ref` → `ref`  — reference sigil stripped (type-directed refs)
 *   2. `list<T>` → `T[]`       — retired generic; innermost-first, fixpoint
 *   3. `[0..1]`/`[*]`/`[1..*]`/`[1]` → `?`/`[]`/`[+]`/removed  — cardinality
 *
 * Everything else the legacy surface carries (doc-only `authoring` blocks,
 * concept `references`, `formal` invariants, the `meta-model` descriptor,
 * numeric literals) is handled by parser tolerance, not here — regex stripping
 * of brace-bearing raw-string examples is fragile. What downgrades in meaning
 * (a `formal` invariant becoming prose) does so at parse time, recorded in the
 * migration report, not silently in the text.
 */

export function rewrite(legacySource: string): string {
  let out = legacySource;
  out = rewriteReferences(out);
  out = rewriteListTypes(out);
  out = rewriteCardinality(out);
  out = rewriteEnumToTaxonomy(out);
  return out;
}

/** `enum X { values { … } }` → `taxonomy X { terms { … } }` (keyword swaps). */
function rewriteEnumToTaxonomy(source: string): string {
  return source.replace(/\benum\b/g, "taxonomy").replace(/\bvalues\b/g, "terms");
}

/** `@m365` / `&m365` → `m365`. Strip the reference sigil before a lowercase
 * identifier start; the type-directed loader resolves bare names as references. */
function rewriteReferences(source: string): string {
  return source.replace(/[@&](?=[a-z])/g, "");
}

/**
 * `list<T>` → `T[]`. A `list<…>` may wrap an `object { … }` that itself
 * contains inner `list<…>`; matching only innermost generics (`[^<>]+`) and
 * looping to a fixpoint lowers them from the inside out. A trailing `[*]` /
 * `[1..*]` on the list is folded into the resulting cardinality.
 */
function rewriteListTypes(source: string): string {
  let previous: string;
  let out = source;
  do {
    previous = out;
    out = out
      .replace(/list<([^<>]+)>\s*\[1\.\.\*\]/g, "$1[+]")
      .replace(/list<([^<>]+)>\s*\[\*\]/g, "$1[]")
      // Bare list only when no bracket follows — a trailing `[*]` / `[1..*]`
      // must fold into the list's cardinality (handled above, next pass).
      .replace(/list<([^<>]+)>(?!\s*\[)/g, "$1[]");
  } while (out !== previous);
  return out;
}

/** Legacy bracket cardinality → new suffix syntax. */
function rewriteCardinality(source: string): string {
  return source
    .replace(/\s*\[0\.\.1\]/g, "?")
    .replace(/\s*\[1\.\.\*\]/g, "[+]")
    .replace(/\s*\[\*\]/g, "[]")
    .replace(/\s*\[1\]/g, "");
}
