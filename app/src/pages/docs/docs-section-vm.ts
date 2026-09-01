import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { compileForDisplay } from "../../../../shared/compile-for-display.js";

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
  static SourceKey = MuralBase.RegisterProperty<string>(DocsSectionVM, "Source", "", MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(DocsSectionVM, "Status", "", MetaData.None);
  static JsonKey = MuralBase.RegisterProperty<string>(DocsSectionVM, "Json", "", MetaData.None);

  get Heading(): string { return this.get_property_value(DocsSectionVM.HeadingKey); }
  get Narrative(): string { return this.get_property_value(DocsSectionVM.NarrativeKey); }
  get Source(): string { return this.get_property_value(DocsSectionVM.SourceKey); }
  get Status(): string { return this.get_property_value(DocsSectionVM.StatusKey); }
  get Json(): string { return this.get_property_value(DocsSectionVM.JsonKey); }

  constructor(entry: CorpusEntry) {
    super();
    const source = entry.sources.map((s) => s.text).join("\n\n");
    const r = compileForDisplay(entry.sources);
    const summary = `${r.document.nodes.length} node(s), ${r.document.edges.length} edge(s)`;
    this.set_property_value(DocsSectionVM.HeadingKey, entry.manifest.title);
    this.set_property_value(DocsSectionVM.NarrativeKey, entry.manifest.narrative);
    // Auto-sized layout: keep the snippet compact so sections stack cleanly.
    this.set_property_value(DocsSectionVM.SourceKey, clip(source, 8));
    const status = r.ok ? `compiles clean — ${summary}` : `${r.diagnostics.length} diagnostic(s) — ${summary}`;
    this.set_property_value(DocsSectionVM.StatusKey, status);
    this.set_property_value(DocsSectionVM.JsonKey, clip(JSON.stringify(r.document, null, 2), 10));
  }
}
