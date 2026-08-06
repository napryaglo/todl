import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../../parse/loader.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(text: string): DiagnosticCode[] {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).model.validate().map((d) => d.code);
}

test("a class is exempt from completeness (may omit required fields)", () => {
  const c = codes(
    `concept Component { realisedBy : string; region : string; } Class component teamsChat { realisedBy = "teams"; }`,
  );
  assert.ok(!c.includes(DiagnosticCode.RequiredMissing));
});

test("a leaf inherits its class's required field — no RequiredMissing", () => {
  const c = codes(
    `concept Component { realisedBy : string; } Class component teamsChat { realisedBy = "teams"; } Component hq instanceof teamsChat {}`,
  );
  assert.ok(!c.includes(DiagnosticCode.RequiredMissing));
});

test("a leaf missing a still-unset required field is flagged", () => {
  const c = codes(
    `concept Component { realisedBy : string; region : string; } Class component teamsChat { realisedBy = "teams"; } Component hq instanceof teamsChat {}`,
  );
  assert.ok(c.includes(DiagnosticCode.RequiredMissing));
});

test("a leaf contradicting a class-fixed field is a ClassOverride", () => {
  const c = codes(
    `concept Component { realisedBy : string; } Class component teamsChat { realisedBy = "teams"; } Component hq instanceof teamsChat { realisedBy = "forked"; }`,
  );
  assert.ok(c.includes(DiagnosticCode.ClassOverride));
});

test("a leaf repeating the same class-fixed value is allowed", () => {
  const c = codes(
    `concept Component { realisedBy : string; } Class component teamsChat { realisedBy = "teams"; } Component hq instanceof teamsChat { realisedBy = "teams"; }`,
  );
  assert.ok(!c.includes(DiagnosticCode.ClassOverride));
});

test("instanceof a non-class is a BindingInvalid", () => {
  const c = codes(`concept Component {} Component plain {} Component hq instanceof plain {}`);
  assert.ok(c.includes(DiagnosticCode.BindingInvalid));
});

test("instanceof a class of a different concept is a BindingInvalid", () => {
  const c = codes(`concept Component {} concept Location {} Class location eu {} Component hq instanceof eu {}`);
  assert.ok(c.includes(DiagnosticCode.BindingInvalid));
});
