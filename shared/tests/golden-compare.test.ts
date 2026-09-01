import { test } from "node:test";
import assert from "node:assert/strict";
import { compareToGolden } from "../golden-compare.js";
import { CORPUS } from "../../examples/corpus.generated.js";

test("an unedited example matches its golden", () => {
  const e = CORPUS.find((x) => x.sources.length === 1)!;
  const r = compareToGolden({ name: e.sources[0].name, text: e.sources[0].text }, e.golden);
  assert.equal(r.matches, true);
});

test("a source that diverges from the golden is flagged", () => {
  // An empty golden vs. a source that emits nodes — unambiguous divergence.
  const empty = { diagnostics: [], document: { nodes: [], edges: [] } };
  const r = compareToGolden({ name: "m.todl", text: "namespace app { concept C { label : string; } }" }, empty);
  assert.equal(r.matches, false);
  assert.ok(r.summary.length > 0);
});
