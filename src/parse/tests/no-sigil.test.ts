import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { EdgeKind, Direction } from "../../model/graph.js";

function loaded(text: string) {
  return loadFiles([{ uri: "s.todl", text }]);
}

const SRC = `namespace d {
  concept Technology { label : string; }
  concept Component { implementedBy : Technology?; }
  model M : D {
    Technology t { label = "T"; }
    Component c { implementedBy = t; }
  }
}`;

test("a bare name resolves as a reference with no sigil, and no parse error", () => {
  const r = loaded(SRC);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === "error"), []);
  assert.deepEqual(r.model.related("c", EdgeKind.Relationship, Direction.Out, "implementedBy"), ["t"]);
});

test("a leftover `&` sigil is now a parse error", () => {
  const r = loaded(SRC.replace("implemented-by = t;", "implemented-by = &t;"));
  assert.ok(r.diagnostics.some((d) => d.severity === "error"));
});
