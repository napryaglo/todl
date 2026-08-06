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
       concept Location { label : string; }
       taxonomy Geo : represents Location {
         Location azure { label = "A"; }
         Location m365  { label = "M"; parent = azure; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("a bare cross-taxonomy reference resolves through `uses`", () => {
  const base = toJSON(check([{ uri: "base.todl", text:
    `namespace ea {
       concept Category { label : string; }
       concept Technology { label : string; applicableTo : Categories; }
       taxonomy Categories : represents Category { term PlatformApi { label = "API"; } }
     }` }]).model);
  const { diagnostics } = checkAgainst([base], [{ uri: "lib.todl", text:
    `namespace lib {
       import ea;
       taxonomy Mtech : represents Technology uses Categories {
         Technology graph { label = "G"; applicableTo = [PlatformApi]; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("without `uses`, the same cross reference is undefined", () => {
  const base = toJSON(check([{ uri: "base.todl", text:
    `namespace ea {
       concept Category { label : string; }
       concept Technology { label : string; applicableTo : Categories; }
       taxonomy Categories : represents Category { term PlatformApi { label = "API"; } }
     }` }]).model);
  const { diagnostics } = checkAgainst([base], [{ uri: "lib.todl", text:
    `namespace lib {
       taxonomy Mtech : represents Technology {
         Technology graph { label = "G"; applicableTo = [PlatformApi]; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.ReferenceUndefined));
});

test("a bare name defined by two used taxonomies is ambiguous", () => {
  const { diagnostics } = check([{ uri: "t.todl", text:
    `namespace n {
       concept C { label : string; ref : A; }
       taxonomy A : represents C { term Dup { label = "1"; } }
       taxonomy B : represents C { term Dup { label = "2"; } }
       taxonomy User : represents C uses A, B {
         C x { label = "X"; ref = Dup; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.TaxonomyAmbiguousBareReference));
});
