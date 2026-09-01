import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";

export class DocsVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(DocsVM, "Title", "Docs", MetaData.None);
  get Title(): string { return this.get_property_value(DocsVM.TitleKey); }
}
