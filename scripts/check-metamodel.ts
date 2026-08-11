// Headless meta-model load-check: glob every .todl under a directory, load them
// through the TODL loader as one project, and print diagnostics grouped by code.
// Usage: npx tsx --conditions=development scripts/check-metamodel.ts <dir>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { check } from "../src/api.js";

function todlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...todlFiles(p));
    else if (entry.endsWith(".todl")) out.push(p);
  }
  return out;
}

const dir = process.argv[2];
if (dir === undefined) { console.error("usage: check-metamodel <dir>"); process.exit(2); }

const files = todlFiles(dir).sort();
const { diagnostics } = check(files.map((uri) => ({ uri, text: readFileSync(uri, "utf8") })));

const byCode = new Map<string, number>();
for (const d of diagnostics) byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1);

console.log(`files: ${files.length}  diagnostics: ${diagnostics.length}`);
for (const [code, n] of [...byCode.entries()].sort()) console.log(`  ${code}: ${n}`);
console.log("--- detail ---");
for (const d of diagnostics) {
  const uri = String(d.span?.uri ?? "").split(/[\\/]/).pop();
  console.log(`  [${d.code}] ${uri}:${d.span?.start?.line ?? "?"}  ${d.message.split("\n")[0].slice(0, 120)}`);
}
