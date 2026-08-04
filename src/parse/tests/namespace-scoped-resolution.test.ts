import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../../api.js";
import { parse } from "../parser.js";
import { toJSON } from "../../emit/json.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

// Namespace-scoped name resolution (design:
// docs/superpowers/specs/2026-08-04-namespace-scoped-resolution-design.md).
// Ids stay flat; a namespace is a VISIBILITY gate: a reference sees its own
// namespace, its file's imports, and the global/prelude scope. Qualified
// `ns.x` resolves the flat node `x` in namespace `ns` — no import needed.

const errs = (ds: { code: DiagnosticCode; severity: string }[]) =>
  ds.filter((d) => d.severity === "error").map((d) => d.code);

// A base in namespace `ea`: concepts + a taxonomy with a term.
const base = () => toJSON(check([{ uri: "ea.todl", text:
  `namespace ea {
     concept category { label : string; }
     concept technology { label : string; applicable-to : categories; }
     taxonomy categories : represents category { term platform-api { label = "API"; } }
   }` }]).model);

test("a bare cross-namespace reference WITHOUT an import is unreachable", () => {
  const { diagnostics } = checkAgainst([base()], [{ uri: "lib.todl", text:
    `namespace lib {
       taxonomy mtech : represents technology uses categories {
         technology graph { label = "G"; applicable-to = [platform-api]; }
       }
     }` }]);
  const codes = errs(diagnostics);
  assert.ok(codes.includes(DiagnosticCode.TaxonomyUsesUndefined), "uses target unreachable");
  assert.ok(codes.includes(DiagnosticCode.ReferenceUnreachable), "represents target unreachable");
  // the unreachable message names the namespace to import
  assert.match(
    diagnostics.find((d) => d.code === DiagnosticCode.ReferenceUnreachable)!.message,
    /import ea/,
  );
});

test("the same reference WITH `import ea` resolves clean", () => {
  const { diagnostics } = checkAgainst([base()], [{ uri: "lib.todl", text:
    `namespace lib {
       import ea;
       taxonomy mtech : represents technology uses categories {
         technology graph { label = "G"; applicable-to = [platform-api]; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("qualified names (represents/uses/value ref) resolve WITHOUT an import", () => {
  const { diagnostics } = checkAgainst([base()], [{ uri: "lib.todl", text:
    `namespace lib {
       taxonomy mtech : represents ea.technology uses ea.categories {
         technology graph { label = "G"; applicable-to = [ea.categories.platform-api]; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("a qualified name with the WRONG namespace is undefined", () => {
  const { diagnostics } = checkAgainst([base()], [{ uri: "lib.todl", text:
    `namespace lib {
       taxonomy mtech : represents zzz.technology {
         technology graph { label = "G"; }
       }
     }` }]);
  assert.ok(errs(diagnostics).includes(DiagnosticCode.ReferenceUndefined));
});

test("prelude symbols (element, string) are reachable everywhere without an import", () => {
  // `concept x { … }` implicitly extends the prelude root `element`, and the
  // field type `string` is a prelude primitive — both must resolve with no import.
  const { diagnostics } = check([{ uri: "n.todl", text:
    `namespace faraway { concept x { label : string; } }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("a flat dotted term id (taxonomy.term) still resolves as the term, not a namespace split", () => {
  // Within one namespace, a bare `parent = azure` and an explicit `geo.azure`
  // both point at the flat term node `geo.azure` — the full-flat-id match wins
  // before any namespace-strip is attempted.
  const { diagnostics } = check([{ uri: "n.todl", text:
    `namespace n {
       concept location { label : string; parent : location?; }
       taxonomy geo : represents location {
         location azure { label = "A"; }
         location m365  { label = "M"; parent = geo.azure; }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("a prelude annotation applies from any namespace without importing `todl`", () => {
  // `icon` is a prelude annotation (namespace `todl`); applying it from another
  // namespace must resolve — the prelude is implicitly imported everywhere.
  const { diagnostics } = check([{ uri: "n.todl", text:
    `namespace faraway {
       concept location { label : string; }
       taxonomy geo : represents location {
         location azure { label = "A"; annotate icon { path = "a.svg"; } }
       }
     }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("every reference site is namespace-gated: qualified resolves, bare cross-ns needs import", () => {
  // A base with a concept in namespace ea.
  const b = toJSON(check([{ uri: "ea.todl", text:
    `namespace ea { concept thing { label : string?; } }` }]).model);

  // Qualified names at extends, field type, record concept, and model bindings —
  // all resolve WITHOUT an import (explicit qualifier).
  const ok = checkAgainst([b], [{ uri: "lib.todl", text:
    `namespace lib {
       concept special : ea.thing { other : ea.thing; }
       model m : ea {
         ea.thing w2 { }
       }
     }` }]);
  assert.deepEqual(errs(ok.diagnostics), []);

  // Bare cross-namespace field type WITHOUT an import → unreachable.
  const bad = checkAgainst([b], [{ uri: "lib.todl", text:
    `namespace lib { concept special { t : thing; } }` }]);
  assert.ok(errs(bad.diagnostics).includes(DiagnosticCode.ReferenceUnreachable));
});

test("built-in scalar types resolve everywhere without a declaration", () => {
  const { diagnostics } = check([{ uri: "n.todl", text:
    `namespace faraway { concept x { a : string; b : boolean; c : integer; d : number; } }` }]);
  assert.deepEqual(errs(diagnostics), []);
});

test("parser: `uses`/`represents` accept namespace-qualified targets", () => {
  const { namespace, diagnostics } = parse(
    `namespace lib {
       taxonomy t : represents ea.concept-a, ea.concept-b uses ea.tax-x, tax-y { }
     }`, "t.todl");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), [], "no syntax error on qualified targets");
  const tax = namespace.declarations.find((d) => (d as { name?: string }).name === "t") as
    { represents: string[]; uses: string[] };
  assert.deepEqual(tax.represents, ["ea.concept-a", "ea.concept-b"]);
  assert.deepEqual(tax.uses, ["ea.tax-x", "tax-y"]);
});
