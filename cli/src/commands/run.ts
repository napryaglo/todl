import { CORPUS } from "../../../examples/corpus.generated.js";
import { byId } from "../../../shared/corpus-access.js";
import { verifyExample } from "../../../shared/verify.js";
import { header, red } from "../format.js";

export function run(id: string | undefined): number {
  if (!id) { process.stdout.write(red("usage: todl-demo run <id>\n")); return 1; }
  const entry = byId(CORPUS, id);
  if (!entry) { process.stdout.write(red(`unknown example: ${id}\n`)); return 1; }
  // The golden IS the normalized pipeline output — print it as the stages.
  const golden = verifyExample(entry, { update: true }).golden!;
  process.stdout.write(header("diagnostics") + "\n");
  if (golden.diagnostics.length === 0) process.stdout.write("  (none)\n");
  for (const d of golden.diagnostics) process.stdout.write(`  ${d.severity} ${d.code} ${d.message}\n`);
  process.stdout.write(header("emitted document (canonical)") + "\n");
  process.stdout.write(JSON.stringify(golden.document, null, 2) + "\n");
  return 0;
}
