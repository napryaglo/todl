// Monaco needs a web worker for its editor services. The base editor worker
// covers our custom TODL language; the read-only JSON viewer additionally needs
// the JSON language worker (else its language service throws `toUrl` on setup).
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import * as monaco from "monaco-editor";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};

// The JSON viewer is read-only display, not an editor — don't run schema
// validation (avoids squiggles + schema fetches on the emitted document).
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false, schemaValidation: "ignore" });

/** The app boots a single fixed dark scheme, so the editor uses a static dark
 *  theme whose background matches the Mural dark @Surface (#1C1B1F) — a fixed
 *  version of Plexus's token-derived theme (no live scheme switching here). */
export const TODL_DARK_THEME = "todl-dark";

let themeDefined = false;
export function registerTodlDarkTheme(): void {
  if (themeDefined) return;
  themeDefined = true;
  monaco.editor.defineTheme(TODL_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#1C1B1F",
      "editorGutter.background": "#1C1B1F",
      "minimap.background": "#1C1B1F",
    },
  });
}
