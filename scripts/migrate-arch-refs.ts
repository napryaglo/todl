// Surgical quoted -> bare migration for the 13 SP2-retyped reference members.
// Rewrites each given .todl file in place. Leaves every other byte unchanged;
// never touches deployed_into / enables (SP2 exceptions, still identifier).
// Usage: npx tsx --conditions=development scripts/migrate-arch-refs.ts <file...>
import { readFileSync, writeFileSync } from "node:fs";

const MEMBERS = [
  "from", "to", "src", "dst", "entry_point", "scenario", "delivered_by",
  "owner", "network", "containers", "consumes", "provides", "contains",
];
const quoted = new RegExp(`^(\\s*)(${MEMBERS.join("|")})(\\s*=\\s*)"([^"]+)"(\\s*;)`, "gm");
// A retyped member holding a list literal would need manual review; flag it.
const listLiteral = new RegExp(`^\\s*(${MEMBERS.join("|")})\\s*=\\s*\\[`, "gm");

for (const file of process.argv.slice(2)) {
  const before = readFileSync(file, "utf8");
  let n = 0;
  const after = before.replace(quoted, (_m, ind, mem, eq, val, semi) => { n++; return `${ind}${mem}${eq}${val}${semi}`; });
  const skipped = [...before.matchAll(listLiteral)].map((m) => m[1]);
  writeFileSync(file, after);
  console.log(`${file}: ${n} converted${skipped.length ? `  SKIPPED list-literals: ${skipped.join(", ")}` : ""}`);
}
