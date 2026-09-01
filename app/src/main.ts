import { Application } from "@pragmatic-tech-ai/mural/runtime";
import { Border, TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { Material, MaterialLight, MaterialDark } from "@pragmatic-tech-ai/mural/resources/material";
// Proves the todl compiler + corpus bundle for the browser:
import { CORPUS } from "../../shared/corpus.js";
import { verifyAll } from "../../shared/verify.js";

const summary = verifyAll(CORPUS);
const message = `TODL corpus: ${CORPUS.length} examples, ${summary.passed} pass, ${summary.failed} fail`;

const app = new Application();
app.initialize({ theme: Material, autoScheme: { light: MaterialLight, dark: MaterialDark } });

// Direct visual tree (no ContentControl/DataTemplate) to isolate text rendering.
const text = new TextBlock();
text.set_property_value(TextBlock.TextKey, message);
text.set_property_value(TextBlock.FontSizeKey, 24);
const border = new Border();
border.SetChild(text);
app.Resources.Root = border;

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));
