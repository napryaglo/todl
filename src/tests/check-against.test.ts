import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../api.js";
import { toJSON } from "../emit/json.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/span.js";

// A base meta-model: concepts + a base taxonomy the library will reference.
const META: SourceFile = {
  uri: "meta.todl",
  text: `namespace ea {
    concept Location  { label : string; }
    concept Technology { label : string; applicableTo : ComponentCategory; }
    concept Category   { label : string; }
    taxonomy ComponentCategory : represents Category { term PlatformApi { label = "API"; } }
  }`,
};

// A library-shaped source: a multi-representation taxonomy over base concepts,
// whose technology term references a base taxonomy term.
const LIB: SourceFile = {
  uri: "microsoft.todl",
  text: `namespace lib {
    import ea;
    taxonomy Microsoft : represents Location, Technology {
      Location azure { label = "Azure"; }
      Technology azureOpenai { label = "Azure OpenAI"; applicableTo = ComponentCategory.PlatformApi; }
    }
  }`,
};

const errorCodes = (ds: Diagnostic[]): string[] =>
  ds.filter((d) => d.severity === Severity.Error).map((d) => d.code);

test("checkAgainst([], sources) equals check(sources)", () => {
  const a = check([META]);
  const b = checkAgainst([], [META]);
  assert.deepEqual(errorCodes(b.diagnostics), errorCodes(a.diagnostics));
  assert.deepEqual(
    b.model.allNodes().map((n) => n.id).sort(),
    a.model.allNodes().map((n) => n.id).sort(),
  );
});

test("a library validates clean against a base meta-model", () => {
  const base = toJSON(check([META]).model);
  const { model, diagnostics } = checkAgainst([base], [LIB]);
  assert.deepEqual(errorCodes(diagnostics), []);
  // The merged model carries both the base concept and the library term.
  assert.ok(model.has("location"));
  assert.equal(model.resolve("Microsoft.Azure")?.typeOf, "location");
  assert.equal(model.resolve("Microsoft.azureOpenai")?.typeOf, "technology");
});

test("a reference resolvable in neither base nor source is still flagged", () => {
  const base = toJSON(check([META]).model);
  const bad: SourceFile = {
    uri: "bad.todl",
    text: `namespace lib { taxonomy M : represents Location { Location x { parent = Nonsense.Ghost; } } }`,
  };
  const { model, diagnostics } = checkAgainst([base], [bad]);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined));
  assert.equal(model.resolve("Nonsense.Ghost"), undefined);
});

test("a reference resolved via the base model is not reported undefined", () => {
  // base defines `location`; source declares an instance of it
  const base = toJSON(check([META]).model);
  const src: SourceFile = {
    uri: "src.todl",
    text: `namespace lib { Location azure { label = "Azure"; } }`,
  };
  const result = checkAgainst([base], [src]);
  assert.equal(result.diagnostics.filter((d) => d.code === DiagnosticCode.ReferenceUndefined).length, 0);
});

test("duplicate bases dedup: same base twice matches once", () => {
  const base = toJSON(check([META]).model);
  const once = checkAgainst([base], [LIB]);
  const twice = checkAgainst([base, base], [LIB]);
  assert.deepEqual(errorCodes(twice.diagnostics), errorCodes(once.diagnostics));
  assert.equal(twice.model.allNodes().length, once.model.allNodes().length);
});
