import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { compileForDisplay } from "../../../../shared/compile-for-display.js";
import { MonacoEditorHost } from "../../editor/monaco-editor-host.js";

/** Keep the first `n` lines; append an ellipsis marker if truncated. */
function clip(text: string, n: number): string {
  const lines = text.split("\n");
  return lines.length <= n ? text : lines.slice(0, n).join("\n") + "\n…";
}

/** One docs section: heading + narrative + the example source and its compiled
 *  output, shown read-only. Renders as fixed-height text blocks (stacks cleanly
 *  in a list; the full interactive runner is the playground's job). */
export class DocsSectionVM extends MuralBase {
  static HeadingKey = MuralBase.RegisterProperty<string>(DocsSectionVM, "Heading", "", MetaData.None);
  static NarrativeKey = MuralBase.RegisterProperty<string>(DocsSectionVM, "Narrative", "", MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(DocsSectionVM, "Status", "", MetaData.None);
  // Read-only Monaco viewers (Mural TextBlock flattens `\n`); auto-height so the
  // clipped snippets size to their content in the stacking detail pane.
  static SourceViewKey = MuralBase.RegisterProperty<MonacoEditorHost | undefined>(DocsSectionVM, "SourceView", undefined, MetaData.None);
  static JsonViewKey = MuralBase.RegisterProperty<MonacoEditorHost | undefined>(DocsSectionVM, "JsonView", undefined, MetaData.None);

  get Heading(): string { return this.get_property_value(DocsSectionVM.HeadingKey); }
  get Narrative(): string { return this.get_property_value(DocsSectionVM.NarrativeKey); }
  get Status(): string { return this.get_property_value(DocsSectionVM.StatusKey); }
  get SourceView(): MonacoEditorHost | undefined { return this.get_property_value(DocsSectionVM.SourceViewKey); }
  get JsonView(): MonacoEditorHost | undefined { return this.get_property_value(DocsSectionVM.JsonViewKey); }

  constructor(entry: CorpusEntry) {
    super();
    const source = entry.sources.map((s) => s.text).join("\n\n");
    const r = compileForDisplay(entry.sources);
    const summary = `${r.document.nodes.length} node(s), ${r.document.edges.length} edge(s)`;
    this.set_property_value(DocsSectionVM.HeadingKey, entry.manifest.title);
    this.set_property_value(DocsSectionVM.NarrativeKey, entry.manifest.narrative);
    const status = r.ok ? `compiles clean — ${summary}` : `${r.diagnostics.length} diagnostic(s) — ${summary}`;
    this.set_property_value(DocsSectionVM.StatusKey, status);
    // Auto-sized viewers: keep the snippet compact so sections stack cleanly.
    this.set_property_value(DocsSectionVM.SourceViewKey, DocsSectionVM.viewer("todl", clip(source, 8)));
    this.set_property_value(DocsSectionVM.JsonViewKey, DocsSectionVM.viewer("json", clip(JSON.stringify(r.document, null, 2), 10)));
  }

  private static viewer(language: string, text: string): MonacoEditorHost {
    const v = new MonacoEditorHost();
    v.useLanguage(language);
    v.ReadOnly = true;
    v.useAutoHeight();
    v.Text = text;
    return v;
  }
}
