import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const codes = (ds: { code: DiagnosticCode }[]) => ds.map((d) => d.code);

// Compile a meta-model + a library as bases, each in its own namespace. The
// library carries a taxonomy (`fleet`) and a class (`ec2`), both in namespace
// `lib`. A model binds the library's namespace by `uses`-ing one of its
// taxonomies — that brings the whole `lib` vocabulary (including `ec2`) in scope.
function bases() {
  const meta = toJSON(check([{ uri: "meta.todl", text:
    `namespace meta { concept server { } }` }]).model);
  const lib = toJSON(checkAgainst([meta], [{ uri: "lib.todl", text:
    `namespace lib { import meta; class server ec2 { } taxonomy fleet : represents server { } }` }]).model);
  return [meta, lib];
}

test("constructors from the meta-model and a bound (via uses) library are in scope", () => {
  const src = `namespace app {
    import meta;
    import lib;
    model prod : meta uses fleet {
      server a { }
      server b instanceof ec2 { }
    }
  }`;
  const { diagnostics } = checkAgainst(bases(), [{ uri: "app.todl", text: src }]);
  assert.ok(!codes(diagnostics).includes(DiagnosticCode.ConstructorOutOfScope));
});

test("a class from a library the model does not bind is out of scope", () => {
  const src = `namespace app {
    import meta;
    import lib;
    model prod : meta {
      server b instanceof ec2 { }
    }
  }`;
  const { diagnostics } = checkAgainst(bases(), [{ uri: "app.todl", text: src }]);
  assert.ok(codes(diagnostics).includes(DiagnosticCode.ConstructorOutOfScope));
});
