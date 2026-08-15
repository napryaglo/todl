import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";

function loadSrc(body: string, gen = new FakeIdGenerator()) {
  const src = `namespace t {
    concept endpoint { label : string; }
    concept step { src : endpoint; dst : endpoint; }
    concept sequence { steps : step[]; }
    concept component { depends_on : component[]; }
    operator ==> : step (src, dst);
    operator ->> : component.depends_on;
    model M : t { ${body} }
  }`;
  return load([{ uri: "t.todl", text: src }], gen);
}

test("an edge value in a list mints a step and binds it to the field", () => {
  const { model, diagnostics } = loadSrc(`endpoint a {} endpoint b {} sequence sq { steps = [ a ==> b ]; }`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  assert.deepEqual(model.refs("sq", "steps"), ["id-0"]);
  assert.deepEqual(model.refs("id-0", "src"), ["a"]);
  assert.deepEqual(model.refs("id-0", "dst"), ["b"]);
});

test("multiple edge values bind in order", () => {
  const { model } = loadSrc(`endpoint a {} endpoint b {} endpoint c {} sequence sq { steps = [ a ==> b, b ==> c ]; }`);
  assert.deepEqual(model.refs("sq", "steps"), ["id-0", "id-1"]);
  assert.deepEqual(model.refs("id-1", "dst"), ["c"]);
});

test("an explicit id in an edge value body is reused", () => {
  const { model } = loadSrc(`endpoint a {} endpoint b {} sequence sq { steps = [ a ==> b { id = s1; } ]; }`);
  assert.deepEqual(model.refs("sq", "steps"), ["s1"]);
});

test("a relationship-form operator as a value is operator.not-a-value", () => {
  const { diagnostics } = loadSrc(`component w {} component d {} sequence sq { steps = [ w ->> d ]; }`);
  assert.ok(diagnostics.map((x) => x.code).includes(DiagnosticCode.OperatorNotAValue));
});

test("an edge value whose concept mismatches the field type is a type error", () => {
  const { diagnostics } = loadSrc(`endpoint a {} endpoint b {} component c { depends_on = [ a ==> b ]; }`);
  assert.ok(diagnostics.map((x) => x.code).includes(DiagnosticCode.InlineObjectType));
});
