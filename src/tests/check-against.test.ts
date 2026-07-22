import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../api.js";
import { toJSON } from "../emit/json.js";
import { Severity, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/span.js";

// A base meta-model: concepts + a base taxonomy the library will reference.
const META: SourceFile = {
  uri: "meta.todl",
  text: `namespace ea {
    concept location  { label : string; }
    concept technology { label : string; applicable-to : component-category; }
    concept category   { label : string; }
    taxonomy component-category : represents category { term platform-api { label = "API"; } }
  }`,
};

// A library-shaped source: a multi-representation taxonomy over base concepts,
// whose technology term references a base taxonomy term.
const LIB: SourceFile = {
  uri: "microsoft.todl",
  text: `namespace lib {
    taxonomy microsoft : represents location, technology {
      location azure { label = "Azure"; }
      technology azure-openai { label = "Azure OpenAI"; applicable-to = component-category.platform-api; }
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
  assert.equal(model.resolve("microsoft.azure")?.typeOf, "location");
  assert.equal(model.resolve("microsoft.azure-openai")?.typeOf, "technology");
});

test("a reference resolvable in neither base nor source is still flagged", () => {
  const base = toJSON(check([META]).model);
  const bad: SourceFile = {
    uri: "bad.todl",
    text: `namespace lib { taxonomy m : represents location { location x { parent = &nonsense.ghost; } } }`,
  };
  const { model } = checkAgainst([base], [bad]);
  assert.equal(model.resolve("nonsense.ghost")?.typeOf, "unresolved");
});

test("duplicate bases dedup: same base twice matches once", () => {
  const base = toJSON(check([META]).model);
  const once = checkAgainst([base], [LIB]);
  const twice = checkAgainst([base, base], [LIB]);
  assert.deepEqual(errorCodes(twice.diagnostics), errorCodes(once.diagnostics));
  assert.equal(twice.model.allNodes().length, once.model.allNodes().length);
});
