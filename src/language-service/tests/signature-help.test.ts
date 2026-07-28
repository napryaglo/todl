import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import { signatureHelpAt } from "../signature-help.js";

test("shows the target and cardinality of a relationship assignment", () => {
  const { analysis, positions, uri } = fixture("d.todl", [
    "namespace demo {",
    "  concept person { }",
    "  concept dog { relationship owner -> person []; }",
    "  dog rex { owner = &‸ }",
    "}",
  ].join("\n"));
  const help = signatureHelpAt(analysis, uri, positions[0]!);
  const label = help?.signatures[0]?.label ?? "";
  assert.match(label, /owner/);
  assert.match(label, /person/);
});

test("null outside an assignment slot", () => {
  const { analysis, positions, uri } = fixture("d.todl",
    "namespace demo {‸\n  concept a { }\n}");
  assert.equal(signatureHelpAt(analysis, uri, positions[0]!), null);
});
