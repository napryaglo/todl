import type { SignatureHelp, SignatureInformation, Position } from "vscode-languageserver-types";
import { Cardinality } from "../model/graph.js";
import type { Analysis } from "./analysis.js";
import { assignmentContextAt } from "./schema-context.js";

const CARD: Record<number, string> = {
  [Cardinality.One]: "", [Cardinality.Optional]: "?",
  [Cardinality.Many]: "[]", [Cardinality.NonEmpty]: "[+]",
};

export function signatureHelpAt(a: Analysis, uri: string, pos: Position): SignatureHelp | null {
  const ctx = assignmentContextAt(a, uri, pos);
  if (ctx === null || ctx.targetConcepts.length === 0) return null;
  const arrow = ctx.isRelationship ? "->" : ":";
  const label = `${ctx.member} ${arrow} ${ctx.targetConcepts.join(" | ")}${CARD[ctx.cardinality] ?? ""}`;
  const signature: SignatureInformation = { label };
  return { signatures: [signature], activeSignature: 0, activeParameter: 0 };
}
