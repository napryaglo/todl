import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { MetaKind } from "../../model/kinds.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function loadResult(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]);
}
function repo(text: string) {
  return loadResult(text).model;
}

test("a viewpoint loads as an ontology node with Frames edges", () => {
  const m = repo(`concept Component {} concept Interface {}
    viewpoint ComponentView : frames Component, Interface`);
  assert.equal(m.resolve("ComponentView")?.typeOf, MetaKind.Viewpoint);
  assert.deepEqual(m.related("ComponentView", EdgeKind.Frames, Direction.Out).sort(), ["Component", "Interface"]);
  assert.deepEqual(m.frames("ComponentView").sort(), ["Component", "Interface"]);
});

test("an unknown framed concept is reported undefined and drops the edge", () => {
  const { model, diagnostics } = loadResult(`viewpoint V : frames Missing`);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined));
  assert.deepEqual(model.frames("V"), []); // no dangling Frames edge
});

test("a qualified framed concept rewrites to its flat id", () => {
  // Component defined in namespace n; qualified n.Component resolves + flattens.
  const { model, diagnostics } = loadResult(`concept Component {}
    viewpoint V : frames n.Component`);
  assert.equal(diagnostics.length, 0);
  assert.deepEqual(model.frames("V"), ["Component"]);
});
