import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";
import { EdgeKind, Direction } from "../../model/graph.js";

// Same shape as edge-value-load, but exercising the BARE STATEMENT form
// (`a ==> b;` on its own line in a record body) rather than the value form
// (`steps = [ a ==> b ]`). A bare nested record already appends to the matching
// array member; a bare edge statement must do the same.
function loadSrc(body: string, gen = new FakeIdGenerator()) {
  const src = `namespace t {
    concept endpoint { label : string; }
    concept step { src : endpoint; dst : endpoint; }
    concept sequence { steps : step[]; }
    concept pair { first : step[]; second : step[]; }
    concept component { depends_on : component[]; }
    operator ==> : step (src, dst);
    operator ->> : component.depends_on;
    model M : t { ${body} }
  }`;
  return load([{ uri: "t.todl", text: src }], gen);
}

test("a bare edge statement in a record body binds the minted step to the matching array field", () => {
  const { model, diagnostics } = loadSrc(`endpoint a {} endpoint b {} sequence sq { a ==> b; }`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  assert.deepEqual(model.refs("sq", "steps"), ["id-0"]);
  assert.deepEqual(model.refs("id-0", "src"), ["a"]);
  assert.deepEqual(model.refs("id-0", "dst"), ["b"]);
});

test("multiple bare edge statements bind in authored order", () => {
  const { model } = loadSrc(`endpoint a {} endpoint b {} endpoint c {} sequence sq { a ==> b; b ==> c; }`);
  assert.deepEqual(model.refs("sq", "steps"), ["id-0", "id-1"]);
  assert.deepEqual(model.refs("id-1", "dst"), ["c"]);
});

test("a bare edge statement with no matching field is containment-only, no error", () => {
  const { model, diagnostics } = loadSrc(`endpoint a {} endpoint b {} component c { a ==> b; }`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  // The step is still minted (endpoints bound) and contained by c, just not
  // bound to any field (component has no step-typed member).
  assert.deepEqual(model.refs("id-0", "src"), ["a"]);
  assert.deepEqual(model.related("c", EdgeKind.Contains, Direction.Out), ["id-0"]);
});

test("a bare edge statement matching two array fields is ambiguous", () => {
  const { diagnostics } = loadSrc(`endpoint a {} endpoint b {} pair p { a ==> b; }`);
  assert.ok(diagnostics.map((d) => d.code).includes(DiagnosticCode.AmbiguousFieldBinding));
});

test("a relationship-form operator statement still writes its ref, no minting or binding", () => {
  const { model, diagnostics } = loadSrc(`component w {} component d {} sequence sq { w ->> d; }`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  assert.deepEqual(model.refs("w", "depends_on"), ["d"]);
  assert.deepEqual(model.refs("sq", "steps"), []);
});
