import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { foldingRanges } from "../folding.js";

test("folds a multi-line brace block", () => {
  const { analysis, uri } = fixture("d.todl", [
    "namespace demo {",   // line 0 — opens
    "  concept a {",      // line 1 — opens
    "    name : string;",
    "  }",                // line 3 — closes line 1
    "}",                  // line 4 — closes line 0
  ].join("\n"));
  const ranges = foldingRanges(analysis, uri).sort((x, y) => x.startLine - y.startLine);
  assert.deepEqual(ranges, [
    { startLine: 0, endLine: 3 },
    { startLine: 1, endLine: 2 },
  ]);
});
