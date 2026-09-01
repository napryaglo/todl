// Browser-side shim for `import opentype from 'opentype.js'`. opentype.js's ESM
// bundle exposes only named exports (no default); the mural runtime imports it
// as a default. This re-exports the namespace as the default so the bundler
// resolves the default-import form. Aliased in vite.config.ts.
// Import the deep path (not the bare specifier, which is aliased to THIS file)
// so we reach the real ESM bundle without looping through the alias.
import * as ot from "opentype.js/dist/opentype.mjs";
export default ot;
