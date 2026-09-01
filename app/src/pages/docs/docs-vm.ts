import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import { CORPUS } from "../../../../examples/corpus.generated.js";
import { byGroup } from "../../../../shared/corpus-access.js";
import { DocsSectionVM } from "./docs-section-vm.js";

export class DocsVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(DocsVM, "Title", "Docs", MetaData.None);
  static SectionsKey = MuralBase.RegisterProperty<DocsSectionVM[]>(DocsVM, "Sections", [], MetaData.None);
  static SelectedKey = MuralBase.RegisterProperty<DocsSectionVM | undefined>(DocsVM, "Selected", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(DocsVM.TitleKey); }
  get Sections(): DocsSectionVM[] { return this.get_property_value(DocsVM.SectionsKey); }

  constructor() {
    super();
    // Corpus ordered by group then manifest.order, one section per example.
    const sections: DocsSectionVM[] = [];
    for (const [, entries] of byGroup(CORPUS)) {
      for (const e of entries) sections.push(new DocsSectionVM(e));
    }
    this.set_property_value(DocsVM.SectionsKey, sections);
    // Open the first section by default so the detail pane is non-empty.
    this.set_property_value(DocsVM.SelectedKey, sections[0]);
  }
}
