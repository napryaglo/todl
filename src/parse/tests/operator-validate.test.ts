import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(decls: string) {
  const src = `namespace t {
    concept endpoint { label : string; }
    concept connector { from : endpoint; to : endpoint; note : string; }
    concept component { depends_on : component[]; }
    ${decls}
  }`;
  return load([{ uri: "t.todl", text: src }], new FakeIdGenerator()).diagnostics.map((d) => d.code);
}

test("a reified endpoint that is not a member is a bad-endpoint error", () => {
  assert.ok(codes(`operator ~> : connector (from, nope);`).includes(DiagnosticCode.OperatorBadEndpoint));
});

test("a reified endpoint that is a primitive (not a reference member) is a bad-endpoint error", () => {
  assert.ok(codes(`operator ~> : connector (from, note);`).includes(DiagnosticCode.OperatorBadEndpoint));
});

test("a relationship form targeting a non-relationship member is a bad-endpoint error", () => {
  assert.ok(codes(`operator ->> : endpoint.label;`).includes(DiagnosticCode.OperatorBadEndpoint));
});

test("a duplicate glyph is operator.redeclared", () => {
  const cs = codes(`operator ~> : connector (from, to); operator ~> : connector (to, from);`);
  assert.ok(cs.includes(DiagnosticCode.OperatorRedeclared));
});

test("a well-formed pair produces no operator diagnostics", () => {
  const cs = codes(`operator ~> : connector (from, to); operator ->> : component.depends_on;`);
  assert.ok(!cs.some((c) => String(c).startsWith("operator.")));
});
