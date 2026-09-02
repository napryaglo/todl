// Monaco needs a web worker for its editor services. We only register a custom
// language (no built-in language workers), so the base editor worker suffices.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as monaco from "monaco-editor";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

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
