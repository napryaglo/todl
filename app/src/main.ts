import { Application } from "@pragmatic-tech-ai/mural/runtime";
import { ContentControl } from "@pragmatic-tech-ai/mural/framework";
import { Border } from "@pragmatic-tech-ai/mural/basic";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { Material, MaterialLight, MaterialDark } from "@pragmatic-tech-ai/mural/resources/material";
// @ts-expect-error compiled by vitePluginMural
import { AppShell } from "./shell.mu";
import { AppVM } from "./app-vm.js";

const app = new Application();
app.initialize({ theme: Material, autoScheme: { light: MaterialLight, dark: MaterialDark } });
for (const [k, v] of AppShell.Clone().Entries()) app.Resources.Set(k, v);

// ContentControl (resolves the AppVM template) hosted inside a Border so it is
// laid out — a bare ContentControl root renders nothing (spike-verified).
const host = new ContentControl();
host.Content = new AppVM();
const root = new Border();
root.SetChild(host);
app.Resources.Root = root;

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));
