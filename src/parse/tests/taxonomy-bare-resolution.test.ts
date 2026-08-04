import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const errs = (ds: { code: DiagnosticCode; severity: string }[]) =>
  ds.filter((d) => d.severity === "error").map((d) => d.code);

test("a bare sibling term reference resolves within the taxonomy", () => {
  const { diagnostics } = check([{ uri: "t.todl", text:
    `namespace n {
       concept location { label : string; }
       taxonomy geo : represents location {
         location azure { label = "A"; }
         location m365  { label = "M"; parent = azure; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("a bare cross-taxonomy reference resolves through `uses`", () => {
  const base = toJSON(check([{ uri: "base.todl", text:
    `namespace ea {
       concept category { label : string; }
       concept technology { label : string; applicable-to : categories; }
       taxonomy categories : represents category { term platform-api { label = "API"; } }
     }` }]).model);
  const { diagnostics } = checkAgainst([base], [{ uri: "lib.todl", text:
    `namespace lib {
       import ea;
       taxonomy mtech : represents technology uses categories {
         technology graph { label = "G"; applicable-to = [platform-api]; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("without `uses`, the same cross reference is undefined", () => {
  const base = toJSON(check([{ uri: "base.todl", text:
    `namespace ea {
       concept category { label : string; }
       concept technology { label : string; applicable-to : categories; }
       taxonomy categories : represents category { term platform-api { label = "API"; } }
     }` }]).model);
  const { diagnostics } = checkAgainst([base], [{ uri: "lib.todl", text:
    `namespace lib {
       taxonomy mtech : represents technology {
         technology graph { label = "G"; applicable-to = [platform-api]; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.ReferenceUndefined));
});

test("a bare name defined by two used taxonomies is ambiguous", () => {
  const { diagnostics } = check([{ uri: "t.todl", text:
    `namespace n {
       concept c { label : string; ref : a; }
       taxonomy a : represents c { term dup { label = "1"; } }
       taxonomy b : represents c { term dup { label = "2"; } }
       taxonomy user : represents c uses a, b {
         c x { label = "X"; ref = dup; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.TaxonomyAmbiguousBareReference));
});
