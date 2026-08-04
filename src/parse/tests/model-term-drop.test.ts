import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

// A model's `uses <taxonomy, …>` clause brings each named taxonomy's terms into
// bare scope for the model's instance value references — the model analogue of a
// taxonomy body's `uses`. Terms are stored as flat `taxonomy.term` nodes; the
// `uses` list is what lets a bare `azure-openai` drop to `stack.azure-openai`.

const errs = (ds: { code: DiagnosticCode; severity: string }[]) =>
  ds.filter((d) => d.severity === "error").map((d) => d.code);

// A base meta-model in namespace `ea`: two concepts + two taxonomies of terms.
const base = () => toJSON(check([{ uri: "ea.todl", text:
  `namespace ea {
     concept technology { label : string; }
     concept category   { label : string; }
     concept component  { label : string; realised-by : technology?; kind : category?; }
     taxonomy stack : represents technology {
       technology azure-openai { label = "AO"; }
       technology azure-func   { label = "AF"; }
     }
     taxonomy kinds : represents category {
       category service { label = "S"; }
     }
   }` }]).model);

test("model `uses <taxonomy>` brings its terms into bare scope", () => {
  const { diagnostics } = checkAgainst([base()], [{ uri: "app.todl", text:
    `namespace app {
       import ea;
       model m : ea uses stack, kinds {
         component gw { label = "GW"; realised-by = azure-openai; kind = service; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("a bare term drops to its flat taxonomy.term node (edge points at stack.azure-openai)", () => {
  const { model } = checkAgainst([base()], [{ uri: "app.todl", text:
    `namespace app {
       import ea;
       model m : ea uses stack {
         component gw { label = "GW"; realised-by = azure-openai; }
       }
     }` }]);
  const doc = toJSON(model);
  const edge = doc.edges.find((e) => String(e.from) === "gw" && e.via === "realised-by");
  assert.ok(edge, "an edge for realised-by exists");
  assert.equal(String(edge!.to), "stack.azure-openai");
});

test("without `uses`, the bare term is undefined", () => {
  const { diagnostics } = checkAgainst([base()], [{ uri: "app.todl", text:
    `namespace app {
       import ea;
       model m : ea {
         component gw { label = "GW"; realised-by = azure-openai; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.ReferenceUndefined));
});

test("qualified `uses ea.stack` normalizes and still brings terms into scope", () => {
  const { diagnostics } = checkAgainst([base()], [{ uri: "app.todl", text:
    `namespace app {
       import ea;
       model m : ea uses ea.stack {
         component gw { label = "GW"; realised-by = azure-openai; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("a bare term is still writable as a fully-qualified node id without `uses`", () => {
  // `stack.azure-openai` is the flat node id; it resolves as-is (no drop needed).
  const { diagnostics } = checkAgainst([base()], [{ uri: "app.todl", text:
    `namespace app {
       import ea;
       model m : ea {
         component gw { label = "GW"; realised-by = stack.azure-openai; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("model `uses` of a non-taxonomy is flagged", () => {
  const { diagnostics } = checkAgainst([base()], [{ uri: "app.todl", text:
    `namespace app {
       import ea;
       model m : ea uses component {
         component gw { label = "GW"; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.TaxonomyUsesUndefined));
});

test("a bare id defined by two used taxonomies is ambiguous", () => {
  const b = toJSON(check([{ uri: "ea.todl", text:
    `namespace ea {
       concept technology { label : string; }
       concept component  { label : string; realised-by : technology?; }
       taxonomy a : represents technology { technology dup { label = "A"; } }
       taxonomy b : represents technology { technology dup { label = "B"; } }
     }` }]).model);
  const { diagnostics } = checkAgainst([b], [{ uri: "app.todl", text:
    `namespace app {
       import ea;
       model m : ea uses a, b {
         component gw { label = "GW"; realised-by = dup; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.TaxonomyAmbiguousBareReference));
});
