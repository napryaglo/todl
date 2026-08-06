/** Identifier-shaping + collision detection for read-client codegen (spec §6, §13). */

function segments(id: string): string[] {
  // Split on -, _, and case boundaries so pascalCase/camelCase are idempotent on
  // the C-like identifiers (and still handle kebab during migration).
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** kebab → PascalCase: "app-component" → "AppComponent". */
export function pascalCase(kebab: string): string {
  return segments(kebab).map(cap).join("");
}

/** kebab → camelCase: "implemented-by" → "implementedBy". */
export function camelCase(kebab: string): string {
  const parts = segments(kebab);
  if (parts.length === 0) return "";
  return parts[0]! + parts.slice(1).map(cap).join("");
}

/** English pluralization heuristic (deterministic; collisions caught by allocateNames). */
export function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/.test(word)) return word + "es";
  return word + "s";
}

/** Map each id through `transform`, throwing on a collision. */
export function allocateNames(
  ids: readonly string[],
  transform: (id: string) => string,
): Map<string, string> {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const id of ids) {
    const name = transform(id);
    const clash = byName.get(name);
    if (clash !== undefined) {
      throw new Error(`codegen name collision: ids "${clash}" and "${id}" both map to "${name}"`);
    }
    byName.set(name, id);
    byId.set(id, name);
  }
  return byId;
}
