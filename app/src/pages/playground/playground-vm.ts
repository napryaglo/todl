import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import { CORPUS } from "../../../../examples/corpus.generated.js";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { ExampleRunnerVM } from "../../components/example-runner/example-runner-vm.js";
import { ExampleRefVM } from "./example-ref-vm.js";
import { readSourceFromHash, writeSourceToHash, copyCurrentLink } from "./permalink-sync.js";

export class PlaygroundVM extends MuralBase {
  static RunnerKey = MuralBase.RegisterProperty<ExampleRunnerVM>(PlaygroundVM, "Runner", undefined as unknown as ExampleRunnerVM, MetaData.None);
  static RefsKey = MuralBase.RegisterProperty<ExampleRefVM[]>(PlaygroundVM, "Refs", [], MetaData.None);
  static SelectedKey = MuralBase.RegisterProperty<ExampleRefVM | undefined>(PlaygroundVM, "Selected", undefined, MetaData.None);
  static CopyLinkKey = MuralBase.RegisterProperty<ICommand | undefined>(PlaygroundVM, "CopyLink", undefined, MetaData.None);

  get Runner(): ExampleRunnerVM { return this.get_property_value(PlaygroundVM.RunnerKey); }
  get Refs(): ExampleRefVM[] { return this.get_property_value(PlaygroundVM.RefsKey); }
  get CopyLink(): ICommand | undefined { return this.get_property_value(PlaygroundVM.CopyLinkKey); }

  constructor() {
    super();
    const runner = new ExampleRunnerVM(true);
    this.set_property_value(PlaygroundVM.RunnerKey, runner);
    this.set_property_value(PlaygroundVM.RefsKey, CORPUS.map((e) => new ExampleRefVM(e)));
    this.set_property_value(PlaygroundVM.CopyLinkKey, new RelayCommand(() => copyCurrentLink()));

    // A shared URL-hash source wins over the default first-example seed.
    const hashed = readSourceFromHash();
    if (hashed !== null) runner.Source = hashed;
    else if (CORPUS[0]) runner.load(CORPUS[0]);

    // Loading a picked example replaces the editor source (triggers compile).
    this.AddPropertyChangedListener(PlaygroundVM.SelectedKey, () => {
      const sel = this.get_property_value(PlaygroundVM.SelectedKey);
      if (sel) runner.load(sel.entry);
    });
    // Debounced: mirror the live source into the URL hash (shareable permalink).
    let timer: ReturnType<typeof setTimeout> | undefined;
    runner.AddPropertyChangedListener(ExampleRunnerVM.SourceKey, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => writeSourceToHash(runner.Source), 400);
    });
  }

  load(entry: CorpusEntry): void { this.Runner.load(entry); }
}
