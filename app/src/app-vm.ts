import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "../../shared/corpus-types.js";
import { PlaygroundVM } from "./pages/playground/playground-vm.js";
import { GalleryVM } from "./pages/gallery/gallery-vm.js";
import { DocsVM } from "./pages/docs/docs-vm.js";

export class AppVM extends MuralBase {
  static ActivePageKey = MuralBase.RegisterProperty<MuralBase | undefined>(AppVM, "ActivePage", undefined, MetaData.None);
  static ShowPlaygroundKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowPlayground", undefined, MetaData.None);
  static ShowGalleryKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowGallery", undefined, MetaData.None);
  static ShowDocsKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowDocs", undefined, MetaData.None);

  private readonly playground = new PlaygroundVM();
  private readonly gallery = new GalleryVM();
  private readonly docs = new DocsVM();

  get ActivePage(): MuralBase | undefined { return this.get_property_value(AppVM.ActivePageKey); }
  get ShowPlayground(): ICommand | undefined { return this.get_property_value(AppVM.ShowPlaygroundKey); }
  get ShowGallery(): ICommand | undefined { return this.get_property_value(AppVM.ShowGalleryKey); }
  get ShowDocs(): ICommand | undefined { return this.get_property_value(AppVM.ShowDocsKey); }

  constructor() {
    super();
    this.set_property_value(AppVM.ActivePageKey, this.playground);
    this.set_property_value(AppVM.ShowPlaygroundKey, new RelayCommand(() => this.set_property_value(AppVM.ActivePageKey, this.playground)));
    this.set_property_value(AppVM.ShowGalleryKey, new RelayCommand(() => this.set_property_value(AppVM.ActivePageKey, this.gallery)));
    this.set_property_value(AppVM.ShowDocsKey, new RelayCommand(() => this.set_property_value(AppVM.ActivePageKey, this.docs)));
  }

  openInPlayground(entry: CorpusEntry): void {
    this.playground.load(entry);
    this.set_property_value(AppVM.ActivePageKey, this.playground);
  }
}
