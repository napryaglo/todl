import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { hoverAt } from "../hover.js";

test("hover on a concept reference shows its kind and name", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {\n  concept animal { }\n  concept dog : ani‸mal { }\n}");
  const hover = hoverAt(analysis, uri, positions[0]!);
  const value = (hover?.contents as { value: string }).value;
  assert.match(value, /concept/);
  assert.match(value, /animal/);
});

test("hover off any symbol is null", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {‸\n  concept a { }\n}");
  assert.equal(hoverAt(analysis, uri, positions[0]!), null);
});
