import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";

export class GalleryVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(GalleryVM, "Title", "Gallery", MetaData.None);
  get Title(): string { return this.get_property_value(GalleryVM.TitleKey); }
}
