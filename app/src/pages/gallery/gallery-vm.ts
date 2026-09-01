import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import { CORPUS } from "../../../../examples/corpus.generated.js";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { GalleryCardVM } from "./gallery-card-vm.js";

export class GalleryVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(GalleryVM, "Title", "Gallery", MetaData.None);
  static CardsKey = MuralBase.RegisterProperty<GalleryCardVM[]>(GalleryVM, "Cards", [], MetaData.None);
  static SelectedKey = MuralBase.RegisterProperty<GalleryCardVM | undefined>(GalleryVM, "Selected", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(GalleryVM.TitleKey); }
  get Cards(): GalleryCardVM[] { return this.get_property_value(GalleryVM.CardsKey); }

  constructor(onOpen: (e: CorpusEntry) => void) {
    super();
    this.set_property_value(GalleryVM.CardsKey, CORPUS.map((e) => new GalleryCardVM(e)));
    // Selecting a card (ListBox row) opens its example in the playground.
    this.AddPropertyChangedListener(GalleryVM.SelectedKey, () => {
      const sel = this.get_property_value(GalleryVM.SelectedKey);
      if (sel) onOpen(sel.entry);
    });
  }
}
