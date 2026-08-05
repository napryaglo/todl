import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { EdgeKind, Direction } from "../../model/graph.js";

function loaded(text: string) {
  return loadFiles([{ uri: "s.todl", text }]);
}

const SRC = `namespace d {
  concept technology { label : string; }
  concept component { implemented-by : technology?; }
  model m : d {
    technology t { label = "T"; }
    component c { implemented-by = t; }
  }
}`;

test("a bare name resolves as a reference with no sigil, and no parse error", () => {
  const r = loaded(SRC);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === "error"), []);
  assert.deepEqual(r.model.related("c", EdgeKind.Relationship, Direction.Out, "implemented-by"), ["t"]);
});

test("a leftover `&` sigil is now a parse error", () => {
  const r = loaded(SRC.replace("implemented-by = t;", "implemented-by = &t;"));
  assert.ok(r.diagnostics.some((d) => d.severity === "error"));
});
