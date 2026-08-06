import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";

test("a parent-less concept implicitly extends element", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept Thing { } }` }]);
  assert.ok(model.supertypesOf("thing").includes("element"), "thing should reach element");
});

test("an explicit parent still reaches element transitively", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept Base { } concept Sub : Base { } }` }]);
  const sup = model.supertypesOf("sub");
  assert.ok(sup.includes("base"), "sub extends base");
  assert.ok(sup.includes("element"), "sub reaches element through base");
});

test("element does not extend itself", () => {
  const { model } = check([{ uri: "a.todl", text: `namespace a { concept Thing { } }` }]);
  assert.ok(!model.supertypesOf("element").includes("element"));
});
