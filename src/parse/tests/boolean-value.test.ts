import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, ValueKind, type InstanceDecl, type BooleanValue } from "../ast.js";

// Parse a single concrete instance's assignment value.
function firstValue(text: string) {
  const { namespace, diagnostics } = parse(text, "t.todl");
  assert.deepEqual(diagnostics, [], "no parse diagnostics");
  const model = namespace.declarations.find((d) => d.kind === DeclKind.Instance) as InstanceDecl;
  return model.assignments[0]!.value;
}

test("`true` parses as a boolean literal value", () => {
  const v = firstValue(`namespace t { component c { visible = true; } }`);
  assert.equal(v.kind, ValueKind.Boolean);
  assert.equal((v as BooleanValue).value, true);
});

test("`false` parses as a boolean literal value", () => {
  const v = firstValue(`namespace t { component c { visible = false; } }`);
  assert.equal(v.kind, ValueKind.Boolean);
  assert.equal((v as BooleanValue).value, false);
});

test("a non-reserved bare identifier is still a name value", () => {
  const v = firstValue(`namespace t { component c { kind = service; } }`);
  assert.equal(v.kind, ValueKind.Name);
});
