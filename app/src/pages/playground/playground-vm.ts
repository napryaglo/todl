import { MuralBase, MetaData, RelayCommand, Visibility, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import { CORPUS } from "../../../../examples/corpus.generated.js";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { compareToGolden } from "../../../../shared/golden-compare.js";
import { ExampleRunnerVM } from "../../components/example-runner/example-runner-vm.js";
import { ExampleRefVM } from "./example-ref-vm.js";
import { readSourceFromHash, writeSourceToHash, copyCurrentLink } from "./permalink-sync.js";

export class PlaygroundVM extends MuralBase {
  static RunnerKey = MuralBase.RegisterProperty<ExampleRunnerVM>(PlaygroundVM, "Runner", undefined as unknown as ExampleRunnerVM, MetaData.None);
  static RefsKey = MuralBase.RegisterProperty<ExampleRefVM[]>(PlaygroundVM, "Refs", [], MetaData.None);
  static SelectedKey = MuralBase.RegisterProperty<ExampleRefVM | undefined>(PlaygroundVM, "Selected", undefined, MetaData.None);
  static CopyLinkKey = MuralBase.RegisterProperty<ICommand | undefined>(PlaygroundVM, "CopyLink", undefined, MetaData.None);
  static GoldenStatusKey = MuralBase.RegisterProperty<string>(PlaygroundVM, "GoldenStatus", "", MetaData.None);
  static GoldenVisibilityKey = MuralBase.RegisterProperty<Visibility>(PlaygroundVM, "GoldenVisibility", Visibility.Collapsed, MetaData.None);

  get Runner(): ExampleRunnerVM { return this.get_property_value(PlaygroundVM.RunnerKey); }
  get Refs(): ExampleRefVM[] { return this.get_property_value(PlaygroundVM.RefsKey); }
  get CopyLink(): ICommand | undefined { return this.get_property_value(PlaygroundVM.CopyLinkKey); }
  get GoldenStatus(): string { return this.get_property_value(PlaygroundVM.GoldenStatusKey); }
  get GoldenVisibility(): Visibility { return this.get_property_value(PlaygroundVM.GoldenVisibilityKey); }

  /** The corpus example currently loaded, or null for a hash/hand-typed session.
   *  Drives the "vs golden" chip (only single-source examples can be compared). */
  private loadedEntry: CorpusEntry | null = null;

  private refreshGolden(): void {
    const e = this.loadedEntry;
    if (!e || e.sources.length !== 1) {
      this.set_property_value(PlaygroundVM.GoldenVisibilityKey, Visibility.Collapsed);
      return;
    }
    const c = compareToGolden({ name: e.sources[0].name, text: this.Runner.Source }, e.golden);
    this.set_property_value(PlaygroundVM.GoldenStatusKey, c.matches ? "✓ matches golden" : "✗ " + c.summary);
    this.set_property_value(PlaygroundVM.GoldenVisibilityKey, Visibility.Visible);
  }

  private loadEntry(entry: CorpusEntry): void {
    this.loadedEntry = entry;
    this.Runner.load(entry);
  }

  constructor() {
    super();
    const runner = new ExampleRunnerVM(true);
    this.set_property_value(PlaygroundVM.RunnerKey, runner);
    this.set_property_value(PlaygroundVM.RefsKey, CORPUS.map((e) => new ExampleRefVM(e)));
    this.set_property_value(PlaygroundVM.CopyLinkKey, new RelayCommand(() => copyCurrentLink()));

    // A shared URL-hash source wins over the default first-example seed. A hashed
    // source has no owning example, so the golden chip stays collapsed.
    const hashed = readSourceFromHash();
    if (hashed !== null) runner.Source = hashed;
    else if (CORPUS[0]) this.loadEntry(CORPUS[0]);

    // Loading a picked example replaces the editor source (triggers compile).
    this.AddPropertyChangedListener(PlaygroundVM.SelectedKey, () => {
      const sel = this.get_property_value(PlaygroundVM.SelectedKey);
      if (sel) this.loadEntry(sel.entry);
    });
    // Debounced: mirror the live source into the URL hash + refresh the chip.
    let timer: ReturnType<typeof setTimeout> | undefined;
    runner.AddPropertyChangedListener(ExampleRunnerVM.SourceKey, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { writeSourceToHash(runner.Source); this.refreshGolden(); }, 400);
    });
    // The initial seed's Source change predates the listener above — show the
    // chip for it once, up front.
    this.refreshGolden();
  }

  load(entry: CorpusEntry): void { this.loadEntry(entry); }
}
