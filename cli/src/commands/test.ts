import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CORPUS } from "../../../examples/corpus.generated.js";
import { verifyAll } from "../../../shared/verify.js";
import { updateGoldens } from "../../../examples/tools/update-goldens.mjs";
import { green, red } from "../format.js";

export function test(update: boolean): number {
  if (update) {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "examples");
    const s = updateGoldens(root);
    process.stdout.write(green(`updated ${s.updated} golden(s). Re-run 'npm run gen:corpus'.\n`));
    return 0;
  }
  const s = verifyAll(CORPUS);
  for (const r of s.results) {
    process.stdout.write(`${r.status === "pass" ? green("pass") : red("FAIL")}  ${r.id}\n`);
    if (r.diff) process.stdout.write(r.diff + "\n");
  }
  process.stdout.write(`\n${s.passed} passed, ${s.failed} failed\n`);
  return s.failed === 0 ? 0 : 1;
}
