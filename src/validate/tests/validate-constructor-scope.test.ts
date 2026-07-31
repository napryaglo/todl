import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (ds: { code: DiagnosticCode }[]) => ds.map((d) => d.code);

// Compile a meta-model + a library as bases, each in its own namespace.
function bases() {
  const meta = toJSON(check([{ uri: "meta.todl", text:
    `namespace meta { concept component { } }` }]).model);
  const lib = toJSON(check([{ uri: "lib.todl", text:
    `namespace lib { concept component { } class component ec2 { } }` }]).model);
  return [meta, lib];
}

test("constructors from the meta-model and a used library are in scope", () => {
  const src = `namespace app {
    model prod : meta uses lib {
      component a { }
      component b instanceof ec2 { }
    }
  }`;
  const { diagnostics } = checkAgainst(bases(), [{ uri: "app.todl", text: src }]);
  assert.ok(!codes(diagnostics).includes(DiagnosticCode.ConstructorOutOfScope));
});

test("a class from a library the model does not use is out of scope", () => {
  const src = `namespace app {
    model prod : meta {
      component b instanceof ec2 { }
    }
  }`;
  const { diagnostics } = checkAgainst(bases(), [{ uri: "app.todl", text: src }]);
  assert.ok(codes(diagnostics).includes(DiagnosticCode.ConstructorOutOfScope));
});
