import { registerTodlDarkTheme, TODL_DARK_THEME } from "./monaco-setup.js";
import * as monaco from "monaco-editor";
import { DomHost } from "@pragmatic-tech-ai/mural/basic";
import { MuralBase, MetaData, Size } from "@pragmatic-tech-ai/mural/runtime";

/** A Mural DomHost that mounts a Monaco editor into the reserved <foreignObject>.
 *  `Text` two-way-syncs with the editor (echo-guarded). Optionally binds the
 *  editor's model to a shared LSP URI so diagnostics land on it. */
export class MonacoEditorHost extends DomHost {
  static TextKey = MuralBase.RegisterProperty<string>(MonacoEditorHost, "Text", "", MetaData.None);
  static ReadOnlyKey = MuralBase.RegisterProperty<boolean>(MonacoEditorHost, "ReadOnly", false, MetaData.None);

  get Text(): string { return this.get_property_value(MonacoEditorHost.TextKey); }
  set Text(v: string) { this.set_property_value(MonacoEditorHost.TextKey, v); }
  get ReadOnly(): boolean { return this.get_property_value(MonacoEditorHost.ReadOnlyKey); }
  set ReadOnly(v: boolean) { this.set_property_value(MonacoEditorHost.ReadOnlyKey, v); }

  private editor?: monaco.editor.IStandaloneCodeEditor;
  private updating = false;
  private modelUri?: string;
  private language = "todl";
  private autoHeight = false;
  private contentHeight = 0;

  constructor() {
    super();
    // DP → editor (external Source changes, e.g. loading an example / permalink).
    this.AddPropertyChangedListener(MonacoEditorHost.TextKey, () => {
      if (this.editor && !this.updating && this.Text !== this.editor.getValue()) this.editor.setValue(this.Text);
    });
    this.AddPropertyChangedListener(MonacoEditorHost.ReadOnlyKey, () => {
      this.editor?.updateOptions({ readOnly: this.ReadOnly });
    });
  }

  /** Bind the editor's model to a fixed LSP document URI (call before mount). */
  useModelUri(uri: string): void { this.modelUri = uri; }

  /** Set the editor language (default "todl"; e.g. "json"/"plaintext" for
   *  read-only viewers). Call before mount. */
  useLanguage(language: string): void { this.language = language; }

  /** Size the host's height to the editor's content (for short read-only
   *  snippets in a stacking layout) instead of filling its container. Call
   *  before mount. */
  useAutoHeight(): void { this.autoHeight = true; }

  /** The mounted Monaco editor, once realized (for callers that register on it). */
  get Editor(): monaco.editor.IStandaloneCodeEditor | undefined { return this.editor; }

  // Self-materialise: touching HostElement on first measure runs CreateHostElement
  // (mounting Monaco), so the renderer sees a ForeignElement to wrap. Without this
  // the foreignObject is never created (the renderer only reads ForeignElement).
  protected override MeasureOverride(available: Size): Size {
    void this.HostElement;
    const base = super.MeasureOverride(available);
    // Auto-height snippets size to their content; width still fills the column.
    if (this.autoHeight && this.contentHeight > 0) {
      const width = Number.isFinite(available.Width) ? available.Width : base.Width;
      return new Size(width, this.contentHeight);
    }
    return base;
  }

  protected override CreateHostElement(document: Document): HTMLElement {
    const el = super.CreateHostElement(document);
    registerTodlDarkTheme();
    const model = this.modelUri
      ? monaco.editor.createModel(this.Text, this.language, monaco.Uri.parse(this.modelUri))
      : monaco.editor.createModel(this.Text, this.language);
    this.editor = monaco.editor.create(el, {
      model, language: this.language, theme: TODL_DARK_THEME, automaticLayout: true, minimap: { enabled: false },
      fontSize: 13, readOnly: this.ReadOnly, scrollBeyondLastLine: false,
    });
    this.editor.onDidChangeModelContent(() => {
      this.updating = true;
      this.set_property_value(MonacoEditorHost.TextKey, this.editor!.getValue());
      this.updating = false;
    });
    if (this.autoHeight) {
      const syncHeight = () => {
        const h = this.editor!.getContentHeight();
        if (h !== this.contentHeight) { this.contentHeight = h; this.InvalidateMeasure(); }
      };
      this.editor.onDidContentSizeChange(syncHeight);
      syncHeight();
    }
    // A host that fully owns input stops native events at its boundary so Mural's
    // routing doesn't fight Monaco's overlay widgets (menus, suggest, etc.).
    for (const ev of ["keydown", "keyup", "pointerdown", "pointerup"]) {
      el.addEventListener(ev, (e) => e.stopPropagation());
    }
    return el;
  }
}
