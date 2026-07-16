/**
 * Migration driver (design spec §9). Walks a legacy source tree, applies the
 * {@link rewrite} transform to every `.todl` / `.architecture.model` file, and
 * either returns the rewritten sources in-memory (for the faithfulness harness)
 * or writes them into a destination tree (for producing the test_project).
 * `.architecture.model` files are renamed to `.todl` on the way out.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { rewrite } from "./rewriter.js";

/** Recursively list every legacy TODL source under `dir`, sorted for determinism. */
export function listTodlSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTodlSources(full));
    } else if (full.endsWith(".todl") || full.endsWith(".model")) {
      // `.todl`, plus legacy `.architecture.model` / `.technology-library.model`.
      out.push(full);
    }
  }
  return out.sort();
}

/** Read + rewrite each file, returning the rewritten sources in order. */
export function migrateFiles(files: string[]): string[] {
  return files.map((file) => rewrite(readFileSync(file, "utf8")));
}

/**
 * Rewrite every source under `srcDir` into `destDir`, preserving the relative
 * tree and renaming `.architecture.model` → `.todl`. Returns the written paths.
 */
export function migrateTree(srcDir: string, destDir: string): string[] {
  const written: string[] = [];
  for (const src of listTodlSources(srcDir)) {
    const outRel = relative(srcDir, src)
      .replace(/\.(architecture|technology-library)\.model$/, ".todl")
      .replace(/\.model$/, ".todl");
    const outPath = join(destDir, outRel);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rewrite(readFileSync(src, "utf8")), "utf8");
    written.push(outPath);
  }
  return written;
}
