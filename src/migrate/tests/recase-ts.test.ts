import { test } from "node:test";
import assert from "node:assert/strict";
import { recaseTsFragments } from "../recase-ts.js";

test("recases .todl inside backtick literals, leaves other TS untouched", () => {
  const ts = [
    "const src = `namespace app { concept app-component : component { } }`;",
    "const other = `just a plain string with app-component`;", // no TODL keyword → untouched
    "expect(id).toBe('app-component');",                        // single-quote assertion → untouched (oracle handles)
  ].join("\n");
  const out = recaseTsFragments(ts);
  assert.match(out, /concept AppComponent : Component/);
  assert.match(out, /just a plain string with app-component/); // unchanged
  assert.match(out, /toBe\('app-component'\)/);                 // unchanged
});

test("passes through ${...} interpolations, recasing only literal chunks", () => {
  const ts = "const s = `concept app-component { x : ${t}; }`;";
  const out = recaseTsFragments(ts);
  assert.match(out, /concept AppComponent \{ x : \$\{t\}; \}/);
});
