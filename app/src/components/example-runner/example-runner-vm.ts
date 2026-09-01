import { MuralBase, MetaData, RelayCommand, Visibility, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import { Canvas } from "@pragmatic-tech-ai/mural/basic";
import type { CorpusEntry } from "../../../../shared/corpus-types.js";
import { compileStages } from "../../../../shared/compile-stages.js";
import { layoutGraph, type LaidOutNode } from "../../../../shared/graph-layout.js";
import { DiagnosticVM } from "./diagnostic-vm.js";
import { buildGraphCanvas } from "./graph-view.js";
import { downloadText, copyText } from "./download.js";

type Stage = "tokens" | "ast" | "model" | "diag" | "json" | "graph";

export class ExampleRunnerVM extends MuralBase {
  static SourceKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Source", "", MetaData.None);
  static EditableKey = MuralBase.RegisterProperty<boolean>(ExampleRunnerVM, "Editable", true, MetaData.None);
  static ReadOnlyKey = MuralBase.RegisterProperty<boolean>(ExampleRunnerVM, "ReadOnly", false, MetaData.None);
  static JsonKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Json", "", MetaData.None);
  static TokensTextKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "TokensText", "", MetaData.None);
  static AstTextKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "AstText", "", MetaData.None);
  static ModelTextKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "ModelText", "", MetaData.None);
  static DiagnosticsKey = MuralBase.RegisterProperty<DiagnosticVM[]>(ExampleRunnerVM, "Diagnostics", [], MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "Status", "", MetaData.None);
  static RunKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "Run", undefined, MetaData.None);
  static GraphKey = MuralBase.RegisterProperty<Canvas | undefined>(ExampleRunnerVM, "Graph", undefined, MetaData.None);
  static SelectedNodeTextKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "SelectedNodeText", "Click a node to inspect it.", MetaData.None);
  // Six pipeline-stage tabs. Visibility DPs drive the .mu (no expression bindings).
  static SelectedStageKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "SelectedStage", "json", MetaData.None);
  static TokensVisibilityKey = MuralBase.RegisterProperty<Visibility>(ExampleRunnerVM, "TokensVisibility", Visibility.Collapsed, MetaData.None);
  static AstVisibilityKey = MuralBase.RegisterProperty<Visibility>(ExampleRunnerVM, "AstVisibility", Visibility.Collapsed, MetaData.None);
  static ModelVisibilityKey = MuralBase.RegisterProperty<Visibility>(ExampleRunnerVM, "ModelVisibility", Visibility.Collapsed, MetaData.None);
  static DiagVisibilityKey = MuralBase.RegisterProperty<Visibility>(ExampleRunnerVM, "DiagVisibility", Visibility.Collapsed, MetaData.None);
  static JsonVisibilityKey = MuralBase.RegisterProperty<Visibility>(ExampleRunnerVM, "JsonVisibility", Visibility.Visible, MetaData.None);
  static GraphVisibilityKey = MuralBase.RegisterProperty<Visibility>(ExampleRunnerVM, "GraphVisibility", Visibility.Collapsed, MetaData.None);
  static ShowTokensKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowTokens", undefined, MetaData.None);
  static ShowAstKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowAst", undefined, MetaData.None);
  static ShowModelKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowModel", undefined, MetaData.None);
  static ShowDiagKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowDiag", undefined, MetaData.None);
  static ShowJsonKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowJson", undefined, MetaData.None);
  static ShowGraphKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowGraph", undefined, MetaData.None);
  static DownloadKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "Download", undefined, MetaData.None);
  static CopyKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "Copy", undefined, MetaData.None);

  get Source(): string { return this.get_property_value(ExampleRunnerVM.SourceKey); }
  set Source(v: string) { this.set_property_value(ExampleRunnerVM.SourceKey, v); }
  get Editable(): boolean { return this.get_property_value(ExampleRunnerVM.EditableKey); }
  get ReadOnly(): boolean { return this.get_property_value(ExampleRunnerVM.ReadOnlyKey); }
  get Json(): string { return this.get_property_value(ExampleRunnerVM.JsonKey); }
  get TokensText(): string { return this.get_property_value(ExampleRunnerVM.TokensTextKey); }
  get AstText(): string { return this.get_property_value(ExampleRunnerVM.AstTextKey); }
  get ModelText(): string { return this.get_property_value(ExampleRunnerVM.ModelTextKey); }
  get Diagnostics(): DiagnosticVM[] { return this.get_property_value(ExampleRunnerVM.DiagnosticsKey); }
  get Status(): string { return this.get_property_value(ExampleRunnerVM.StatusKey); }
  get Run(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.RunKey); }
  get Graph(): Canvas | undefined { return this.get_property_value(ExampleRunnerVM.GraphKey); }
  get SelectedNodeText(): string { return this.get_property_value(ExampleRunnerVM.SelectedNodeTextKey); }
  get SelectedStage(): string { return this.get_property_value(ExampleRunnerVM.SelectedStageKey); }
  get TokensVisibility(): Visibility { return this.get_property_value(ExampleRunnerVM.TokensVisibilityKey); }
  get AstVisibility(): Visibility { return this.get_property_value(ExampleRunnerVM.AstVisibilityKey); }
  get ModelVisibility(): Visibility { return this.get_property_value(ExampleRunnerVM.ModelVisibilityKey); }
  get DiagVisibility(): Visibility { return this.get_property_value(ExampleRunnerVM.DiagVisibilityKey); }
  get JsonVisibility(): Visibility { return this.get_property_value(ExampleRunnerVM.JsonVisibilityKey); }
  get GraphVisibility(): Visibility { return this.get_property_value(ExampleRunnerVM.GraphVisibilityKey); }
  get ShowTokens(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowTokensKey); }
  get ShowAst(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowAstKey); }
  get ShowModel(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowModelKey); }
  get ShowDiag(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowDiagKey); }
  get ShowJson(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowJsonKey); }
  get ShowGraph(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowGraphKey); }
  get Download(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.DownloadKey); }
  get Copy(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.CopyKey); }

  private fileName = "playground.todl";

  private setStage(stage: Stage): void {
    const v = (s: Stage) => (s === stage ? Visibility.Visible : Visibility.Collapsed);
    this.set_property_value(ExampleRunnerVM.TokensVisibilityKey, v("tokens"));
    this.set_property_value(ExampleRunnerVM.AstVisibilityKey, v("ast"));
    this.set_property_value(ExampleRunnerVM.ModelVisibilityKey, v("model"));
    this.set_property_value(ExampleRunnerVM.DiagVisibilityKey, v("diag"));
    this.set_property_value(ExampleRunnerVM.JsonVisibilityKey, v("json"));
    this.set_property_value(ExampleRunnerVM.GraphVisibilityKey, v("graph"));
    this.set_property_value(ExampleRunnerVM.SelectedStageKey, stage);
  }

  constructor(editable = true) {
    super();
    this.set_property_value(ExampleRunnerVM.EditableKey, editable);
    // `IsReadOnly` on the editor binds a plain boolean DP (no expression binding).
    this.set_property_value(ExampleRunnerVM.ReadOnlyKey, !editable);
    this.set_property_value(ExampleRunnerVM.RunKey, new RelayCommand(() => this.compile()));
    this.set_property_value(ExampleRunnerVM.ShowTokensKey, new RelayCommand(() => this.setStage("tokens")));
    this.set_property_value(ExampleRunnerVM.ShowAstKey, new RelayCommand(() => this.setStage("ast")));
    this.set_property_value(ExampleRunnerVM.ShowModelKey, new RelayCommand(() => this.setStage("model")));
    this.set_property_value(ExampleRunnerVM.ShowDiagKey, new RelayCommand(() => this.setStage("diag")));
    this.set_property_value(ExampleRunnerVM.ShowJsonKey, new RelayCommand(() => this.setStage("json")));
    this.set_property_value(ExampleRunnerVM.ShowGraphKey, new RelayCommand(() => this.setStage("graph")));
    this.set_property_value(ExampleRunnerVM.DownloadKey, new RelayCommand(() => downloadText(this.fileName.replace(/\.todl$/, "") + ".json", this.Json)));
    this.set_property_value(ExampleRunnerVM.CopyKey, new RelayCommand(() => copyText(this.Json)));
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
    const s = compileStages({ name: this.fileName, text: this.Source });
    const hasError = s.diagnostics.some((d) => d.severity === "error");
    this.set_property_value(ExampleRunnerVM.DiagnosticsKey, s.diagnostics.map((d) => new DiagnosticVM(d)));
    this.set_property_value(ExampleRunnerVM.StatusKey, hasError ? `${s.diagnostics.length} problem(s)` : "OK");
    this.set_property_value(ExampleRunnerVM.JsonKey, JSON.stringify(s.document, null, 2));
    this.set_property_value(ExampleRunnerVM.TokensTextKey,
      s.tokens.map((t) => `${t.line}:${t.column}`.padEnd(7) + `${t.kind}`.padEnd(13) + t.value).join("\n"));
    this.set_property_value(ExampleRunnerVM.AstTextKey, s.astText);
    this.set_property_value(ExampleRunnerVM.ModelTextKey,
      [...s.modelRows.map((r) => `${r.id}  ${r.tier}  ${r.label}`), "",
       ...s.edgeRows.map((e) => `${e.from} --${e.kind}--> ${e.to}`)].join("\n"));
    // A fresh Canvas each compile avoids stale-child accumulation and re-triggers
    // ContentControl presentation.
    const onSelect = (n: LaidOutNode) => this.set_property_value(ExampleRunnerVM.SelectedNodeTextKey,
      [`${n.id} · ${n.sub} · typeOf ${n.typeOf}`, ...Object.entries(n.attrs).map(([k, v]) => `${k} = ${JSON.stringify(v)}`)].join("\n"));
    this.set_property_value(ExampleRunnerVM.GraphKey, buildGraphCanvas(layoutGraph(s.document), onSelect));
  }
}
