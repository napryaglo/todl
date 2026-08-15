import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";

function loadSrc(body: string, gen = new FakeIdGenerator()) {
  const src = `namespace t {
    concept endpoint { label : string; }
    concept connector { from : endpoint; to : endpoint; kind : string; }
    concept component { depends_on : component[]; }
    operator ~> : connector (from, to);
    operator ->> : component.depends_on;
    model M : t { ${body} }
  }`;
  return load([{ uri: "t.todl", text: src }], gen);
}

test("a reified-edge operator mints a contained, endpoint-bound node", () => {
  const { model, diagnostics } = loadSrc(`endpoint a { label = "a"; } endpoint b { label = "b"; } a ~> b;`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  assert.ok(model.resolve("id-0"), "edge node id-0 minted");
  assert.deepEqual(model.refs("id-0", "from"), ["a"]);
  assert.deepEqual(model.refs("id-0", "to"), ["b"]);
});

test("a reified-edge body assignment lands on the minted node", () => {
  const { model } = loadSrc(`endpoint a { label = "a"; } endpoint b { label = "b"; } a ~> b { kind = "sync"; };`);
  assert.equal(model.resolve("id-0")?.attrs.get("kind"), "sync");
});

test("an explicit id in the body is reused", () => {
  const { model } = loadSrc(`endpoint a { label = "a"; } endpoint b { label = "b"; } a ~> b { id = link1; };`);
  assert.ok(model.resolve("link1"), "author id reused");
  assert.deepEqual(model.refs("link1", "from"), ["a"]);
});

test("a relationship-form operator adds one edge, no node", () => {
  const { model } = loadSrc(`component w {} component d {} w ->> d;`);
  assert.deepEqual(model.related("w", EdgeKind.Relationship, Direction.Out, "depends_on"), ["d"]);
});

test("an unknown glyph is operator.undefined", () => {
  const { diagnostics } = loadSrc(`component w {} component d {} w >>> d;`);
  assert.ok(diagnostics.map((x) => x.code).includes(DiagnosticCode.OperatorUndefined));
});
