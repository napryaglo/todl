import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../api.js";

const CONCEPTS = `namespace ea { concept component { label : string; } }`;
// One syntax error (in bad.todl) + one semantic error (missing required label).
const BAD = `namespace app { component teams-chat { } component @@@ { } }`;

test("check returns syntax + semantic diagnostics, partitionable by uri", () => {
  const { diagnostics } = check([
    { uri: "c.todl", text: CONCEPTS },
    { uri: "bad.todl", text: BAD },
  ]);
  assert.ok(diagnostics.length >= 2);
  assert.ok(diagnostics.every((d) => d.span === null || typeof d.span.uri === "string"));
  const byUri = diagnostics.filter((d) => d.span?.uri === "bad.todl");
  assert.ok(byUri.some((d) => d.code.startsWith("syntax.")));
  assert.ok(byUri.some((d) => d.code.startsWith("cardinality.")));
});
