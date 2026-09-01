// Node-only: read the examples/ tree into CorpusEntry[]. Filesystem lives here,
// never in shared/. Folders whose name starts with "_" are tooling fixtures and
// are still loaded (the caller decides whether to include them).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CorpusEntry, ExampleManifest, Golden } from "../../shared/corpus-types.js";

export function loadExamplesFromDisk(root: string): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  for (const dir of findExampleDirs(root)) {
    const manifest = JSON.parse(readFileSync(join(dir, "example.json"), "utf8")) as ExampleManifest;
    const sources = manifest.files.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
    const goldenPath = join(dir, "golden.json");
    const golden: Golden = existsJson(goldenPath)
      ? JSON.parse(readFileSync(goldenPath, "utf8"))
      : { diagnostics: [], document: { nodes: [], edges: [] } };
    entries.push({ manifest, sources, golden, dir: relative(root, dir).split(sep).join("/") });
  }
  return entries.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

function findExampleDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let hasManifest = false;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "example.json") hasManifest = true;
    }
    if (hasManifest) out.push(d);
  };
  walk(root);
  return out;
}

function existsJson(p: string): boolean {
  try { statSync(p); return true; } catch { return false; }
}
