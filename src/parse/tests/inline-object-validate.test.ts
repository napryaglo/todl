import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(instances: string) {
  const src = `namespace t {
    concept slot { environment : string; }
    concept fancy_slot : slot {}
    concept component { slots : slot[]; label : string; }
    model M : t { ${instances} }
  }`;
  return load([{ uri: "t.todl", text: src }], new FakeIdGenerator()).diagnostics.map((d) => d.code);
}

test("inline object on a primitive field is a target error", () => {
  const cs = codes(`component c1 { label = slot { environment = "x"; }; }`);
  assert.ok(cs.includes(DiagnosticCode.InlineObjectTarget));
});

test("inline object whose concept mismatches the field type is a type error", () => {
  const cs = codes(`component c1 { slots = [ component { } ]; }`);
  assert.ok(cs.includes(DiagnosticCode.InlineObjectType));
});

test("a subtype of the field type is accepted", () => {
  const cs = codes(`component c1 { slots = [ fancy_slot { environment = "x"; } ]; }`);
  assert.ok(!cs.includes(DiagnosticCode.InlineObjectType) && !cs.includes(DiagnosticCode.InlineObjectTarget));
});
