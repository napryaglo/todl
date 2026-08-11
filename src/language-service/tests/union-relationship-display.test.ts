import { test } from "node:test";
import assert from "node:assert/strict";

import { fixture } from "./fixtures.js";
import { hoverAt } from "../hover.js";
import { assignmentContextAt } from "../schema-context.js";

const SRC = [
  "namespace demo {",
  "  concept actor { }",
  "  concept component { }",
  "  concept edge { relationship from -> actor | component []; }",
  "  concept sub : ed‸ge { }",
  "  edge e1 { from = &‸ }",
  "}",
].join("\n");

test("hover on a concept renders a union relationship as a | b", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const hover = hoverAt(analysis, uri, positions[0]!);
  const value = (hover?.contents as { value: string }).value;
  assert.match(value, /`from` → actor \| component/);
});

test("assignmentContext of a union relationship returns all target concepts", () => {
  const { analysis, positions, uri } = fixture("d.todl", SRC);
  const ctx = assignmentContextAt(analysis, uri, positions[1]!);
  assert.equal(ctx?.member, "from");
  assert.deepEqual(ctx?.targetConcepts, ["actor", "component"]);
  assert.equal(ctx?.isRelationship, true);
});
