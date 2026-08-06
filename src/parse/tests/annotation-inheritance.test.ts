import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { Severity } from "../../diagnostics/diagnostic.js";

function errors(src: string) {
  return check([{ uri: "n.todl", text: src }]).diagnostics.filter((d) => d.severity === Severity.Error);
}

test("a sub-annotation inherits its base params via effectiveSchema", () => {
  const { model, diagnostics } = check([{ uri: "n.todl", text:
    `namespace n { annotation Visual { icon : string; } annotation Detailed : Visual { badge : string; } }` }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  const names = model.effectiveSchema("Detailed").fields.map((f) => f.name).sort();
  assert.deepEqual(names, ["badge", "icon"]);
});

test("applying a sub-annotation requires an inherited required param", () => {
  // `detailed` inherits required `icon`; omitting it must error — proving app
  // validation flows through inheritance with no validator change.
  const src = `namespace n {
    annotation Visual { icon : string; }
    annotation Detailed : Visual { badge : string; }
    concept Thing { annotate Detailed { badge = "b"; } }
  }`;
  assert.ok(errors(src).some((d) => d.message.includes('requires parameter "icon"')));
});

test("annotation extending a non-annotation errors (base-not-annotation)", () => {
  const src = `namespace n { concept C {} annotation Bad : C { p : string; } }`;
  assert.ok(errors(src).some((d) => d.code === "annotation.base-not-annotation"));
});

test("redeclaring an inherited param errors (param-redeclared)", () => {
  const src = `namespace n {
    annotation Visual { icon : string; }
    annotation Detailed : Visual { icon : string; badge : string; }
  }`;
  assert.ok(errors(src).some((d) => d.code === "annotation.param-redeclared"));
});

test("a no-base annotation raises neither new error", () => {
  assert.deepEqual(errors(`namespace n { annotation Icon { path : string; } }`), []);
});
