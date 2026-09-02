import { tokenize, parse, type TodlDocument } from "@pragmatic-tech-ai/todl";
import type { ExampleSource, GoldenDiagnostic } from "./corpus-types.js";
import { compileForDisplay } from "./compile-for-display.js";
import { nodeLabel } from "./graph-layout.js";

export interface TokenRow { kind: string; value: string; line: number; column: number }
export interface ModelRow { id: string; tier: string; typeOf: string; label: string }
export interface StageResult {
  tokens: TokenRow[]; astText: string;
  modelRows: ModelRow[]; edgeRows: { kind: string; from: string; to: string }[];
  diagnostics: GoldenDiagnostic[]; document: TodlDocument;
}

// Numeric AST enums aren't re-exported from the package; inline the names so the
// tree reads well. (DeclKind / ValueKind from parse/ast.)
const DECL = ["Primitive", "Taxonomy", "Viewpoint", "Concept", "Instance", "Model", "Annotation", "Package", "Operator"];
const VALUE = ["String", "Name", "List", "Composite", "Boolean", "Object", "Edge"];

/** Generic indented AST outline: header per object (kind-name + salient scalars),
 *  recursing into array/object children. Span keys are dropped as noise. */
function formatAst(node: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(node)) return node.map((n) => formatAst(n, indent)).filter((s) => s.length).join("\n");
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    // DeclKind and ValueKind both start at 0; a value node carries text/parts/
    // items/concept/edge, so prefer the ValueKind name for those.
    const isValue = o.text !== undefined || o.parts !== undefined || o.items !== undefined || o.edge !== undefined;
    const kind = o.declarations !== undefined ? "Namespace"
      : typeof o.kind === "number"
        ? (isValue ? VALUE[o.kind] ?? DECL[o.kind] : DECL[o.kind] ?? VALUE[o.kind]) ?? `#${o.kind}`
        : undefined;
    const scalars = Object.entries(o)
      .filter(([k, v]) => !/span/i.test(k) && k !== "kind" && (typeof v === "string" || typeof v === "boolean") && String(v).length)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    const head = `${pad}${kind ?? "Node"}${scalars ? " " + scalars : ""}`;
    const kids = Object.entries(o)
      .filter(([k, v]) => !/span/i.test(k) && (Array.isArray(v) || (v && typeof v === "object")))
      .map(([, v]) => formatAst(v, indent + 1)).filter((s) => s.length);
    return [head, ...kids].join("\n");
  }
  return "";
}

export function compileStages(source: ExampleSource, options?: { debug?: boolean }): StageResult {
  const tokens: TokenRow[] = tokenize(source.text).map((t) => ({ kind: t.kind, value: t.value, line: t.line, column: t.column }));
  const parsed = parse(source.text, source.name);
  const astText = parsed.diagnostics.length
    ? `parse: ${parsed.diagnostics[0].message}\n\n${formatAst(parsed.namespace)}`
    : formatAst(parsed.namespace);
  const display = compileForDisplay([source], options);
  const modelRows: ModelRow[] = display.document.nodes.map((n) => ({
    id: String(n.id), tier: n.tier, typeOf: String(n.typeOf), label: nodeLabel(n),
  }));
  const edgeRows = display.document.edges.map((e) => ({ kind: e.kind, from: String(e.from), to: String(e.to) }));
  return { tokens, astText, modelRows, edgeRows, diagnostics: display.diagnostics, document: display.document };
}
