// Remove dead `operator = "…";` lines (the synthetic edge-arrow attr) from
// each given .todl file, in place. Nothing declares or reads `operator`.
// Usage: npx tsx --conditions=development scripts/strip-edge-operator.ts <file...>
import { readFileSync, writeFileSync } from "node:fs";

const line = /^[ \t]*operator[ \t]*=[ \t]*"[^"]*"[ \t]*;[ \t]*\r?\n/gm;

for (const file of process.argv.slice(2)) {
  const before = readFileSync(file, "utf8");
  const matches = before.match(line);
  const after = before.replace(line, "");
  writeFileSync(file, after);
  console.log(`${file}: ${matches ? matches.length : 0} removed`);
}
