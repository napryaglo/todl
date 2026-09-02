import { Application } from "@pragmatic-tech-ai/mural/runtime";
import { ContentControl } from "@pragmatic-tech-ai/mural/framework";
import { Border } from "@pragmatic-tech-ai/mural/basic";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { Material, MaterialDark } from "@pragmatic-tech-ai/mural/resources/material";
// @ts-expect-error compiled by vitePluginMural
import { AppShell } from "./shell.mu";
// @ts-expect-error compiled by vitePluginMural
import { ExampleRunner } from "./components/example-runner/example-runner.mu";
// @ts-expect-error compiled by vitePluginMural
import { Playground } from "./pages/playground/playground.mu";
// @ts-expect-error compiled by vitePluginMural
import { Gallery } from "./pages/gallery/gallery.mu";
// @ts-expect-error compiled by vitePluginMural
import { Docs } from "./pages/docs/docs.mu";
import { AppVM } from "./app-vm.js";
import { initTodlEditor } from "./editor/todl-editor.js";

const app = new Application();
// Boot dark unconditionally (ignore OS preference) — Plexus does the same via
// `Application [ Theme = Material, Scheme = MaterialDark ]`.
app.initialize({ theme: Material, scheme: MaterialDark });
for (const dict of [AppShell, ExampleRunner, Playground, Gallery, Docs]) {
  for (const [k, v] of dict.Clone().Entries()) app.Resources.Set(k, v);
}

// ContentControl (resolves the AppVM template) hosted inside a Border so it is
// laid out — a bare ContentControl root renders nothing (spike-verified).
// Register the TODL language + start the language-server Web Worker before the
// playground's Monaco editor mounts.
initTodlEditor();

const host = new ContentControl();
host.Content = new AppVM();
const root = new Border();
root.SetChild(host);
app.Resources.Root = root;

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));
