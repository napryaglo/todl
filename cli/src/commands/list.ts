import { CORPUS } from "../../../examples/corpus.generated.js";
import { byGroup } from "../../../shared/corpus-access.js";
import { header, dim } from "../format.js";

export function list(): number {
  for (const [group, entries] of byGroup(CORPUS)) {
    process.stdout.write(header(group) + "\n");
    for (const e of entries) process.stdout.write(`  ${e.manifest.id}  ${dim(e.manifest.title)}\n`);
  }
  return 0;
}
