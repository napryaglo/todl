import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CORPUS } from "../../../examples/corpus.generated.js";
import { renderDocs } from "../../../shared/docs-markdown.js";
import { header, green } from "../format.js";

/** `todl-demo docs [--out <dir>]` — emit the corpus as static markdown. */
export function docs(args: string[]): number {
  const i = args.indexOf("--out");
  const outDir = i >= 0 && args[i + 1] ? args[i + 1] : "docs/showcase";
  const files = renderDocs(CORPUS);
  for (const f of files) {
    const dest = join(outDir, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content, "utf8");
  }
  process.stdout.write(header("docs") + "\n");
  process.stdout.write(green(`  wrote ${files.length} file(s) to ${outDir}\n`));
  return 0;
}
