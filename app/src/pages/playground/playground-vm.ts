import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";

export class PlaygroundVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(PlaygroundVM, "Title", "Playground", MetaData.None);
  get Title(): string { return this.get_property_value(PlaygroundVM.TitleKey); }
  load(_entry: unknown): void { /* Task 4 */ }
}
