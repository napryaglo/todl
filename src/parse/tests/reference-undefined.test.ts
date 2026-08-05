import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { DiagnosticCode, Severity, type Diagnostic } from "../../diagnostics/diagnostic.js";

function src(text: string) { return { uri: "t.todl", text }; }
function undefinedRefs(diags: Diagnostic[]): Diagnostic[] {
  return diags.filter((d) => d.code === DiagnosticCode.ReferenceUndefined);
}

test("undefined instanceOf target → ReferenceUndefined, node kept, no stub", () => {
  const { model, diagnostics } = load([
    src(`namespace n { concept thing {} thing a instanceof ghost {} }`),
  ]);
  const refs = undefinedRefs(diagnostics);
  assert.equal(refs.length, 1);
  const ref = refs[0];
  assert.ok(ref);
  assert.equal(ref.severity, Severity.Error);
  assert.match(ref.message, /ghost/);
  assert.ok(model.resolve("a") !== undefined, "referencing node survives");
  assert.equal(model.resolve("ghost"), undefined, "no UNRESOLVED stub");
});

test("undefined concept extends target → ReferenceUndefined", () => {
  const { diagnostics } = load([src(`namespace n { concept c : missing {} }`)]);
  const refs = undefinedRefs(diagnostics);
  assert.equal(refs.length, 1);
  const ref = refs[0];
  assert.ok(ref);
  assert.match(ref.message, /missing/);
});

test("undefined value ref → ReferenceUndefined", () => {
  const { model, diagnostics } = load([
    src(`namespace n { concept thing { relationship rel -> thing; } thing a { rel = ghost; } }`),
  ]);
  assert.equal(undefinedRefs(diagnostics).length, 1);
  assert.equal(model.resolve("ghost"), undefined);
});

test("a reference to a defined symbol produces no diagnostic", () => {
  const { diagnostics } = load([
    src(`namespace n { concept thing {} thing a {} thing b instanceof a {} }`),
  ]);
  assert.equal(undefinedRefs(diagnostics).length, 0);
});

test("two references to the same undefined id → two diagnostics", () => {
  const { diagnostics } = load([
    src(`namespace n { concept thing { relationship rel -> thing; } thing a { rel = ghost; } thing b { rel = ghost; } }`),
  ]);
  assert.equal(undefinedRefs(diagnostics).length, 2);
});

test("undefined taxonomy represents target → ReferenceUndefined", () => {
  const { diagnostics } = load([
    src(`namespace n { taxonomy t : represents ghostconcept { } }`),
  ]);
  const refs = undefinedRefs(diagnostics);
  assert.equal(refs.length, 1);
  const ref = refs[0];
  assert.ok(ref);
  assert.match(ref.message, /ghostconcept/);
});

test("undefined bare Name value → ReferenceUndefined, referencing node kept", () => {
  const { model, diagnostics } = load([
    src(`namespace n { concept thing { relationship rel -> thing; } thing a { rel = ghostname; } }`),
  ]);
  const refs = undefinedRefs(diagnostics);
  assert.equal(refs.length, 1);
  const ref = refs[0];
  assert.ok(ref);
  assert.match(ref.message, /ghostname/);
  assert.ok(model.resolve("a") !== undefined, "referencing node survives");
  assert.equal(model.resolve("ghostname"), undefined, "no stub for undefined Name target");
});
