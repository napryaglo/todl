import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../../parse/loader.js";
import { validate } from "../validate.js";

// `label` is required (cardinality One) but missing → a diagnostic on the instance.
const CONCEPTS = `namespace ea { concept Component { label : string; } }`;
const MODEL = `namespace app { Component teamsChat { } }`;

test("a required-missing diagnostic carries the instance's span", () => {
  const { model } = load([
    { uri: "c.todl", text: CONCEPTS },
    { uri: "app.todl", text: MODEL },
  ]);
  const diagnostics = validate(model);
  const missing = diagnostics.find((d) => d.path === "Component.Label");
  assert.ok(missing);
  assert.equal(missing!.span?.uri, "app.todl"); // resolved to the instance declaration
});
