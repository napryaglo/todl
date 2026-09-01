import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import type { GoldenDiagnostic } from "../../../../shared/corpus-types.js";

export class DiagnosticVM extends MuralBase {
  static LineKey = MuralBase.RegisterProperty<string>(DiagnosticVM, "Line", "", MetaData.None);
  get Line(): string { return this.get_property_value(DiagnosticVM.LineKey); }
  constructor(d: GoldenDiagnostic) {
    super();
    const at = d.span ? ` (${d.span.uri}:${d.span.start.line}:${d.span.start.column})` : "";
    this.set_property_value(DiagnosticVM.LineKey, `${d.severity} ${d.code}${at} — ${d.message}`);
  }
}
