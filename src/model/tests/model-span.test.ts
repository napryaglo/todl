import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../model.js";
import type { SourceSpan } from "../../diagnostics/span.js";

const span = (uri: string): SourceSpan => ({ uri, start: { line: 2, column: 1 }, end: { line: 2, column: 8 } });

test("records and resolves a node span, and a member-qualified span", () => {
  const model = new Model();
  model.recordSpan("teams-chat", span("a.todl"));
  model.recordSpan(Model.memberKey("teams-chat", "label"), span("b.todl"));

  assert.equal(model.spanOf("teams-chat")?.uri, "a.todl");
  assert.equal(model.spanOf(Model.memberKey("teams-chat", "label"))?.uri, "b.todl");
  assert.equal(model.spanOf("missing"), null);
});
