// Monaco needs a web worker for its editor services. We only register a custom
// language (no built-in language workers), so the base editor worker suffices.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
