// TEMP Phase-6 boot/wiring spike — proves the Monaco + Web-Worker-LSP stack
// (highlighting + live diagnostics) before the real playground swap (Task 6),
// which deletes this file.
import * as monaco from "monaco-editor";
import type { Border } from "@pragmatic-tech-ai/mural/basic";
import { MonacoEditorHost } from "./monaco-editor-host.js";
import { registerTodlLanguage } from "./todl-monarch.js";
import { TodlLanguageClient, PLAYGROUND_URI } from "./todl-language-client.js";

export function runBootSpike(root: Border): void {
  registerTodlLanguage();
  const client = new TodlLanguageClient();
  client.registerProviders();

  const editor = new MonacoEditorHost();
  editor.useModelUri(PLAYGROUND_URI);   // diagnostics land on this model
  editor.Text = "namespace app { concept Component { label : string; } model M : app { Component c { } } }";
  root.SetChild(editor);

  // Push the live text to the server (debounced) so it republishes diagnostics.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const push = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void client.openOrUpdate(editor.Text), 250); };
  editor.AddPropertyChangedListener(MonacoEditorHost.TextKey, push);
  push();   // initial open

  // TEMP test hooks: marker count + a completion round-trip.
  const w = window as unknown as { __todlMarkers?: () => number; __todlCompletion?: () => Promise<number> };
  w.__todlMarkers = () => monaco.editor.getModelMarkers({}).length;
  w.__todlCompletion = async () => {
    const res = await client.request<unknown[]>("textDocument/completion", { line: 0, character: 10 });
    return Array.isArray(res) ? res.length : (res as { items?: unknown[] } | null)?.items?.length ?? 0;
  };
}
