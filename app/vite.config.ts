import { defineConfig } from "vite";
import { vitePluginMural } from "@pragmatic-tech-ai/mural/tooling";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export default defineConfig({
  root: here,
  plugins: [vitePluginMural()],
  // Mural resolves themes/schemes/DataTemplates by runtime `Class.name`, so the
  // minifier must NOT rename classes/functions or scheme lookup breaks
  // (e.g. "theme 'Material' has no scheme 'Lm'").
  esbuild: { keepNames: true },
  // esnext so top-level await (used in the bootstrap to await fonts) is allowed.
  build: { target: "esnext" },
  resolve: {
    alias: [
      // The todl compiler resolves to the parent package's built dist for the
      // browser (shared/verify imports it). Alias guarantees resolution from
      // the app subfolder regardless of package self-reference support.
      { find: "@pragmatic-tech-ai/todl", replacement: resolve(repoRoot, "dist/index.js") },
      // opentype.js ships an ESM bundle with no default export; mural imports
      // it as a default. Redirect the BARE specifier (exact regex, so the
      // shim's own deep `opentype.js/dist/...` import escapes) to a shim that
      // re-exports the namespace as default.
      { find: /^opentype\.js$/, replacement: resolve(here, "src/opentype-shim.mjs") },
    ],
  },
  server: {
    // Allow importing repo-root shared/ and examples/ from the app subfolder.
    fs: { allow: [repoRoot, resolve(repoRoot, "..", "Mural")] },
  },
});
