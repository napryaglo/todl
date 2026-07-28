import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { assignmentContextAt } from "../schema-context.js";

test("resolves the target concept of a relationship assignment", () => {
  const { analysis, positions, uri } = fixture("d.todl", [
    "namespace demo {",
    "  concept person { }",
    "  concept dog { relationship owner -> person []; }",
    "  dog rex { owner = &‸ }",
    "}",
  ].join("\n"));
  const ctx = assignmentContextAt(analysis, uri, positions[0]!);
  assert.equal(ctx?.concept, "dog");
  assert.equal(ctx?.member, "owner");
  assert.equal(ctx?.targetConcept, "person");
  assert.equal(ctx?.isRelationship, true);
});

test("returns null outside any assignment slot", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {‸\n  concept a { }\n}");
  assert.equal(assignmentContextAt(analysis, uri, positions[0]!), null);
});
