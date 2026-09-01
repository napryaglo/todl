import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeState, decodeState } from "../permalink.js";

test("round-trips ASCII source", () => {
  const s = `namespace app { concept C { label : string; } }`;
  assert.equal(decodeState("#" + encodeState(s))!.source, s);
});
test("round-trips unicode", () => {
  const s = `// café ☕ — naïve\nnamespace app { }`;
  assert.equal(decodeState(encodeState(s))!.source, s);
});
test("malformed hash → null", () => {
  assert.equal(decodeState("#nope=1"), null);
  assert.equal(decodeState(""), null);
  assert.equal(decodeState("#s=@@@notbase64@@@"), null);
});
