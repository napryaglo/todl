import { Application } from "@pragmatic-tech-ai/mural/runtime";
import { ContentControl } from "@pragmatic-tech-ai/mural/framework";
import { Border } from "@pragmatic-tech-ai/mural/basic";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { Material, MaterialLight, MaterialDark } from "@pragmatic-tech-ai/mural/resources/material";
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
import { runBootSpike } from "./editor/boot-spike.js";

const app = new Application();
app.initialize({ theme: Material, autoScheme: { light: MaterialLight, dark: MaterialDark } });
for (const dict of [AppShell, ExampleRunner, Playground, Gallery, Docs]) {
  for (const [k, v] of dict.Clone().Entries()) app.Resources.Set(k, v);
}

// ContentControl (resolves the AppVM template) hosted inside a Border so it is
// laid out — a bare ContentControl root renders nothing (spike-verified).
const host = new ContentControl();
host.Content = new AppVM();
const root = new Border();
root.SetChild(host);
app.Resources.Root = root;

// --- TEMP Phase-6 Task-2 boot spike (replaced by real wiring in Task 6) ---
// Swaps the root's content for a Monaco editor host + runs a worker `initialize`.
runBootSpike(root);
// --- end boot spike ---

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));
