import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type ViewpointDecl } from "../ast.js";

function viewpoint(src: string): ViewpointDecl {
  const { namespace } = parse(`namespace n {\n${src}\n}`, "t.todl");
  const decl = namespace.declarations.find((d) => d.kind === DeclKind.Viewpoint);
  assert.ok(decl, "expected a viewpoint declaration");
  return decl as ViewpointDecl;
}

test("viewpoint parses a single framed concept", () => {
  const v = viewpoint(`viewpoint ComponentView : frames Component`);
  assert.equal(v.name, "ComponentView");
  assert.deepEqual(v.frames, ["Component"]);
});

test("viewpoint parses multiple comma-separated framed concepts", () => {
  const v = viewpoint(`viewpoint ComponentView : frames Component, Interface, Node`);
  assert.deepEqual(v.frames, ["Component", "Interface", "Node"]);
  assert.equal(v.framesSpans?.length, 3);
});

test("viewpoint accepts namespace-qualified frames targets", () => {
  const v = viewpoint(`viewpoint V : frames archmm.Component`);
  assert.deepEqual(v.frames, ["archmm.Component"]);
});

test("a viewpoint (no body) is followed cleanly by the next declaration", () => {
  const { namespace } = parse(
    `namespace n {\nviewpoint V : frames Component\nconcept Component {}\n}`,
    "t.todl",
  );
  const kinds = namespace.declarations.map((d) => d.kind);
  assert.ok(kinds.includes(DeclKind.Viewpoint));
  assert.ok(kinds.includes(DeclKind.Concept));
});
