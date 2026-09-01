import { MuralBase, MetaData, RelayCommand, Visibility, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import { Canvas } from "@pragmatic-tech-ai/mural/basic";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { compileForDisplay } from "../../../../shared/compile-for-display.js";
import { layoutGraph } from "../../../../shared/graph-layout.js";
import { DiagnosticVM } from "./diagnostic-vm.js";
import { buildGraphCanvas } from "./graph-view.js";

export class ExampleRunnerVM extends MuralBase {
  static SourceKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Source", "", MetaData.None);
  static EditableKey = MuralBase.RegisterProperty<boolean>(ExampleRunnerVM, "Editable", true, MetaData.None);
  static ReadOnlyKey = MuralBase.RegisterProperty<boolean>(ExampleRunnerVM, "ReadOnly", false, MetaData.None);
  static JsonKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Json", "", MetaData.None);
  static DiagnosticsKey = MuralBase.RegisterProperty<DiagnosticVM[]>(ExampleRunnerVM, "Diagnostics", [], MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Status", "", MetaData.None);
  static RunKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "Run", undefined, MetaData.None);
  // Output view: text JSON vs. the typed-graph diagram. Visibility DPs drive the
  // .mu (no expression bindings — matches the ReadOnly-boolean convention).
  static GraphKey = MuralBase.RegisterProperty<Canvas | undefined>(ExampleRunnerVM, "Graph", undefined, MetaData.None);
  static JsonVisibilityKey = MuralBase.RegisterProperty<Visibility>(ExampleRunnerVM, "JsonVisibility", Visibility.Visible, MetaData.None);
  static GraphVisibilityKey = MuralBase.RegisterProperty<Visibility>(ExampleRunnerVM, "GraphVisibility", Visibility.Collapsed, MetaData.None);
  static ShowJsonKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowJson", undefined, MetaData.None);
  static ShowGraphKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowGraph", undefined, MetaData.None);

  get Source(): string { return this.get_property_value(ExampleRunnerVM.SourceKey); }
  set Source(v: string) { this.set_property_value(ExampleRunnerVM.SourceKey, v); }
  get Editable(): boolean { return this.get_property_value(ExampleRunnerVM.EditableKey); }
  get ReadOnly(): boolean { return this.get_property_value(ExampleRunnerVM.ReadOnlyKey); }
  get Json(): string { return this.get_property_value(ExampleRunnerVM.JsonKey); }
  get Diagnostics(): DiagnosticVM[] { return this.get_property_value(ExampleRunnerVM.DiagnosticsKey); }
  get Status(): string { return this.get_property_value(ExampleRunnerVM.StatusKey); }
  get Run(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.RunKey); }
  get Graph(): Canvas | undefined { return this.get_property_value(ExampleRunnerVM.GraphKey); }
  get JsonVisibility(): Visibility { return this.get_property_value(ExampleRunnerVM.JsonVisibilityKey); }
  get GraphVisibility(): Visibility { return this.get_property_value(ExampleRunnerVM.GraphVisibilityKey); }
  get ShowJson(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowJsonKey); }
  get ShowGraph(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowGraphKey); }

  private fileName = "playground.todl";

  private setView(view: "json" | "graph"): void {
    this.set_property_value(ExampleRunnerVM.JsonVisibilityKey, view === "json" ? Visibility.Visible : Visibility.Collapsed);
    this.set_property_value(ExampleRunnerVM.GraphVisibilityKey, view === "graph" ? Visibility.Visible : Visibility.Collapsed);
  }

  constructor(editable = true) {
    super();
    this.set_property_value(ExampleRunnerVM.EditableKey, editable);
    // `IsReadOnly` on the editor binds a plain boolean DP (no expression binding).
    this.set_property_value(ExampleRunnerVM.ReadOnlyKey, !editable);
    this.set_property_value(ExampleRunnerVM.RunKey, new RelayCommand(() => this.compile()));
    this.set_property_value(ExampleRunnerVM.ShowJsonKey, new RelayCommand(() => this.setView("json")));
    this.set_property_value(ExampleRunnerVM.ShowGraphKey, new RelayCommand(() => this.setView("graph")));
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
    // A fresh Canvas each compile avoids stale-child accumulation and re-triggers
    // ContentControl presentation.
    this.set_property_value(ExampleRunnerVM.GraphKey, buildGraphCanvas(layoutGraph(r.document)));
  }
}
