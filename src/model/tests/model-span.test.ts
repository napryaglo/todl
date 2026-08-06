import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../model.js";
import type { SourceSpan } from "../../diagnostics/span.js";

const span = (uri: string): SourceSpan => ({ uri, start: { line: 2, column: 1 }, end: { line: 2, column: 8 } });

test("records and resolves a node span, and a member-qualified span", () => {
  const model = new Repository();
  model.recordSpan("teamsChat", span("a.todl"));
  model.recordSpan(Repository.memberKey("teamsChat", "label"), span("b.todl"));

  assert.equal(model.spanOf("teamsChat")?.uri, "a.todl");
  assert.equal(model.spanOf(Repository.memberKey("teamsChat", "label"))?.uri, "b.todl");
  assert.equal(model.spanOf("missing"), null);
});
