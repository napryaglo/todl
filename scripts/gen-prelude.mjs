// Generate src/stdlib/prelude.generated.ts from prelude.todl. The prelude must
// be a string constant embedded in the module so it survives bundling to a
// single file (esbuild/CJS), where import.meta.url and sibling-file reads break.
// prelude.todl stays the hand-editable source of truth; run this to sync.
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../src/stdlib/prelude.todl", import.meta.url), "utf8");
const out =
  "// GENERATED from prelude.todl by scripts/gen-prelude.mjs — do not edit by hand.\n" +
  `export const PRELUDE_SOURCE = ${JSON.stringify(src)};\n`;
writeFileSync(new URL("../src/stdlib/prelude.generated.ts", import.meta.url), out);
console.log("wrote src/stdlib/prelude.generated.ts");
