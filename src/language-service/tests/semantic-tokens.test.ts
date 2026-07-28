import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { semanticTokens, SEMANTIC_LEGEND } from "../semantic-tokens.js";

// Decode the flat [dLine,dChar,len,type,mods] quintuples into absolute tokens.
function decode(data: number[]) {
  const out: { line: number; char: number; len: number; type: string }[] = [];
  let line = 0, char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const dLine = data[i]!, dChar = data[i + 1]!, len = data[i + 2]!, type = data[i + 3]!;
    line += dLine;
    char = dLine === 0 ? char + dChar : dChar;
    out.push({ line, char, len, type: SEMANTIC_LEGEND.tokenTypes[type]! });
  }
  return out;
}

test("classifies a concept reference and definition by role", () => {
  const { analysis, uri } = fixture("d.todl",
    "namespace demo {\n  concept animal { }\n  concept dog : animal { }\n}");
  const toks = decode(semanticTokens(analysis, uri).data);
  // The `animal` reference in `: animal` (0-based line 2, char 16) is a 'type'.
  const ref = toks.find((t) => t.line === 2 && t.char === 16);
  assert.equal(ref?.type, "type");
  assert.equal(ref?.len, 6);
  // The `animal` definition name (line 1) is also typed as a 'type'.
  const def = toks.find((t) => t.line === 1 && t.char === 10);
  assert.equal(def?.type, "type");
});
