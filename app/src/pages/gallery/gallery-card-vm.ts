import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { verifyExample } from "../../../../shared/verify.js";

export class GalleryCardVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(GalleryCardVM, "Title", "", MetaData.None);
  static TagsKey = MuralBase.RegisterProperty<string>(GalleryCardVM, "Tags", "", MetaData.None);
  static BadgeKey = MuralBase.RegisterProperty<string>(GalleryCardVM, "Badge", "", MetaData.None);

  get Title(): string { return this.get_property_value(GalleryCardVM.TitleKey); }
  get Tags(): string { return this.get_property_value(GalleryCardVM.TagsKey); }
  get Badge(): string { return this.get_property_value(GalleryCardVM.BadgeKey); }

  readonly entry: CorpusEntry;

  constructor(entry: CorpusEntry) {
    super();
    this.entry = entry;
    this.set_property_value(GalleryCardVM.TitleKey, entry.manifest.title);
    this.set_property_value(GalleryCardVM.TagsKey, entry.manifest.tags.join(", "));
    // Live in-browser verification against the committed golden.
    this.set_property_value(GalleryCardVM.BadgeKey, verifyExample(entry).status === "pass" ? "pass" : "FAIL");
  }
}
