// Generate examples/corpus.generated.ts from the examples/ tree. Inlines every
// manifest, source text, and golden as constants so the browser (Phase 2) needs
// no filesystem and no fetch. Excludes _fixture/* (tooling-only). Mirrors
// scripts/gen-prelude.mjs. Run after gen:goldens.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../examples/", import.meta.url)); // win-safe

function dirs(d) {
  const out = [];
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) out.push(...dirs(p));
    else if (name === "example.json") out.push(d);
  }
  return out;
}

const entries = dirs(root)
  .map((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, "example.json"), "utf8"));
    const sources = manifest.files.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
    const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8"));
    const rel = relative(root, dir).split(sep).join("/");
    return { manifest, sources, golden, dir: rel };
  })
  .filter((e) => !e.dir.startsWith("_fixture/"))
  .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

const out =
  "// GENERATED from examples/ by scripts/gen-corpus.mjs — do not edit by hand.\n" +
  'import type { CorpusEntry } from "../shared/corpus-types.js";\n\n' +
  `export const CORPUS: CorpusEntry[] = ${JSON.stringify(entries, null, 2)};\n`;

writeFileSync(new URL("../examples/corpus.generated.ts", import.meta.url), out);
console.log(`wrote examples/corpus.generated.ts (${entries.length} examples)`);
