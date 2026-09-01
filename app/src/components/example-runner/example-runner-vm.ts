import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { compileForDisplay } from "../../../../shared/compile-for-display.js";
import { DiagnosticVM } from "./diagnostic-vm.js";

export class ExampleRunnerVM extends MuralBase {
  static SourceKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Source", "", MetaData.None);
  static EditableKey = MuralBase.RegisterProperty<boolean>(ExampleRunnerVM, "Editable", true, MetaData.None);
  static ReadOnlyKey = MuralBase.RegisterProperty<boolean>(ExampleRunnerVM, "ReadOnly", false, MetaData.None);
  static JsonKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Json", "", MetaData.None);
  static DiagnosticsKey = MuralBase.RegisterProperty<DiagnosticVM[]>(ExampleRunnerVM, "Diagnostics", [], MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Status", "", MetaData.None);
  static RunKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "Run", undefined, MetaData.None);

  get Source(): string { return this.get_property_value(ExampleRunnerVM.SourceKey); }
  set Source(v: string) { this.set_property_value(ExampleRunnerVM.SourceKey, v); }
  get Editable(): boolean { return this.get_property_value(ExampleRunnerVM.EditableKey); }
  get ReadOnly(): boolean { return this.get_property_value(ExampleRunnerVM.ReadOnlyKey); }
  get Json(): string { return this.get_property_value(ExampleRunnerVM.JsonKey); }
  get Diagnostics(): DiagnosticVM[] { return this.get_property_value(ExampleRunnerVM.DiagnosticsKey); }
  get Status(): string { return this.get_property_value(ExampleRunnerVM.StatusKey); }
  get Run(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.RunKey); }

  private fileName = "playground.todl";

  constructor(editable = true) {
    super();
    this.set_property_value(ExampleRunnerVM.EditableKey, editable);
    // `IsReadOnly` on the editor binds a plain boolean DP (no expression binding).
    this.set_property_value(ExampleRunnerVM.ReadOnlyKey, !editable);
    this.set_property_value(ExampleRunnerVM.RunKey, new RelayCommand(() => this.compile()));
    // Debounced auto-run on edit.
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.AddPropertyChangedListener(ExampleRunnerVM.SourceKey, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.compile(), 300);
    });
  }

  load(entry: CorpusEntry): void {
    this.fileName = entry.sources[0]?.name ?? "example.todl";
    // Setting Source triggers the debounced compile via the listener.
    this.set_property_value(ExampleRunnerVM.SourceKey, entry.sources.map((s) => s.text).join("\n\n"));
  }

  compile(): void {
    const r = compileForDisplay([{ name: this.fileName, text: this.Source }]);
    this.set_property_value(ExampleRunnerVM.DiagnosticsKey, r.diagnostics.map((d) => new DiagnosticVM(d)));
    this.set_property_value(ExampleRunnerVM.JsonKey, JSON.stringify(r.document, null, 2));
    this.set_property_value(ExampleRunnerVM.StatusKey, r.ok ? "OK" : `${r.diagnostics.length} problem(s)`);
  }
}
