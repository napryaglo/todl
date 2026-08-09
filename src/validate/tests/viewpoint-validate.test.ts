import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, Tier } from "../../model/graph.js";
import { Repository } from "../../model/model.js";
import { MetaKind } from "../../model/kinds.js";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

test("a viewpoint that frames nothing is flagged (graph-built backstop)", () => {
  // The parser requires >=1 frames target, so this state is only reachable
  // for a graph-built / base-composed viewpoint node with no Frames edges.
  const g = new Graph();
  g.addNode({ id: "Empty", tier: Tier.Ontology, typeOf: MetaKind.Viewpoint, attrs: new Map() });
  const codes = new Repository(g).validate().map((d) => d.code);
  assert.ok(codes.includes(DiagnosticCode.ViewpointNoFramedConcept));
});

test("a viewpoint that frames a non-concept is flagged", () => {
  // T is a taxonomy, not a concept.
  const { diagnostics } = check([{
    uri: "t.todl",
    text: `namespace n {\nconcept C {}\ntaxonomy T : represents C {}\nviewpoint V : frames T\n}`,
  }]);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ViewpointFramesNotConcept));
});

test("a viewpoint that frames a concept is clean", () => {
  const { diagnostics } = check([{
    uri: "t.todl",
    text: `namespace n {\nconcept Component {}\nviewpoint V : frames Component\n}`,
  }]);
  assert.equal(diagnostics.filter((d) =>
    d.code === DiagnosticCode.ViewpointNoFramedConcept ||
    d.code === DiagnosticCode.ViewpointFramesNotConcept).length, 0);
});
