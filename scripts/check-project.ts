// Validate an architecture project: load the meta-model dir + named library
// files + the project's data dir into one graph via check() (prelude injected),
// and report diagnostics scoped to the data dir. Exit 1 if any.
// Usage: npx tsx --conditions=development scripts/check-project.ts <metaModelDir> <dataDir> <libFile...>
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

const [metaDir, dataDir, ...libs] = process.argv.slice(2);
if (metaDir === undefined || dataDir === undefined) {
  console.error("usage: check-project <metaModelDir> <dataDir> <libFile...>");
  process.exit(2);
}

const norm = (p: string) => p.replace(/\\/g, "/");
const dataPaths = todlFiles(dataDir);
const allPaths = [...todlFiles(metaDir), ...libs, ...dataPaths];
const { diagnostics } = check(allPaths.map((uri) => ({ uri, text: readFileSync(uri, "utf8") })));

const dataSet = new Set(dataPaths.map(norm));
const data = diagnostics.filter((d) => dataSet.has(norm(String(d.span?.uri ?? ""))));

const byCode = new Map<string, number>();
for (const d of data) byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1);
console.log(`total: ${diagnostics.length}  data-file: ${data.length}`);
for (const [code, n] of [...byCode.entries()].sort()) console.log(`  ${code}: ${n}`);
for (const d of data.slice(0, 40)) {
  const u = norm(String(d.span?.uri ?? "")).split("/").pop();
  console.log(`  [${d.code}] ${u}:${d.span?.start?.line ?? "?"}  ${d.message.split("\n")[0].slice(0, 100)}`);
}
process.exit(data.length > 0 ? 1 : 0);
