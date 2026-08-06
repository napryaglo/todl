import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { Repository } from "../../model/model.js";

const CONCEPTS = `namespace ea {
  concept Component { label : string; }
}`;
const MODEL = `namespace app {
  import ea;
  model M : Ea {
    Component teamsChat { label = "Teams"; }
  }
}`;

test("load takes SourceFiles, builds a model, and records instance spans", () => {
  const { model, diagnostics } = load([
    { uri: "concepts.todl", text: CONCEPTS },
    { uri: "app.todl", text: MODEL },
  ]);
  assert.equal(diagnostics.length, 0);
  assert.ok(model.has("teamsChat"));
  assert.equal(model.spanOf("teamsChat")?.uri, "app.todl");
  assert.equal(model.spanOf(Repository.memberKey("teamsChat", "label"))?.uri, "app.todl");
});

test("load surfaces syntax diagnostics from a malformed file", () => {
  const { diagnostics } = load([{ uri: "bad.todl", text: "namespace x { concept @@@ { } }" }]);
  assert.ok(diagnostics.some((d) => d.span?.uri === "bad.todl"));
});
