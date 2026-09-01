import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";

/** A lightweight picker row wrapping a corpus entry. ComboBox's item text reader
 *  recognizes a `Label` property, so the dropdown shows the example title. */
export class ExampleRefVM extends MuralBase {
  static LabelKey = MuralBase.RegisterProperty<string>(ExampleRefVM, "Label", "", MetaData.None);
  get Label(): string { return this.get_property_value(ExampleRefVM.LabelKey); }
  readonly entry: CorpusEntry;
  constructor(entry: CorpusEntry) {
    super();
    this.entry = entry;
    this.set_property_value(ExampleRefVM.LabelKey, entry.manifest.title);
  }
}
