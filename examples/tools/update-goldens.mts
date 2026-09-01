// Node-only: recompute and write every example's golden.json. Reuses the pure
// verify path so what it writes is exactly what the regression test asserts.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyExample } from "../../shared/verify.js";
import type { VerifySummary } from "../../shared/corpus-types.js";
import { loadExamplesFromDisk } from "./load-from-disk.mjs";

export function updateGoldens(root: string): VerifySummary {
  const entries = loadExamplesFromDisk(root);
  const results = entries.map((entry) => {
    const r = verifyExample(entry, { update: true });
    writeFileSync(join(root, entry.dir, "golden.json"), JSON.stringify(r.golden, null, 2) + "\n", "utf8");
    return r;
  });
  return { passed: 0, failed: 0, updated: results.length, results };
}

// Runnable directly: `tsx examples/tools/update-goldens.mts`
if (process.argv[1] && process.argv[1].endsWith("update-goldens.mts")) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const s = updateGoldens(root);
  console.log(`updated ${s.updated} golden(s)`);
}
