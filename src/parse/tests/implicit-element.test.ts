import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";

test("a parent-less concept implicitly extends element", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept Thing { } }` }]);
  assert.ok(model.supertypesOf("Thing").includes("Element"), "Thing should reach Element");
});

test("an explicit parent still reaches element transitively", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept Base { } concept Sub : Base { } }` }]);
  const sup = model.supertypesOf("Sub");
  assert.ok(sup.includes("Base"), "Sub extends Base");
  assert.ok(sup.includes("Element"), "Sub reaches Element through Base");
});

test("element does not extend itself", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept Thing { } }` }]);
  assert.ok(!model.supertypesOf("Element").includes("Element"));
});
