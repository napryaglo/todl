import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAgainst } from "../../api.js";

const fileA = { uri: "a.todl", text: `namespace acme {
  concept Component {}
  viewpoint ComponentView : frames Component
  model Arch : acme conforms ComponentView { Component web {} }
}` };
const fileB = { uri: "b.todl", text: `namespace acme {
  concept Node {}
  viewpoint DeploymentView : frames Node, Component
  model Arch : acme conforms DeploymentView { Node host {} }
}` };

test("two same-id model blocks across files compose into one model (no crash)", () => {
  const { model } = checkAgainst([], [fileA, fileB]);
  // One merged model node containing both files' entities.
  assert.equal(model.resolve("Arch")?.typeOf, "model");
  assert.equal(model.resolve("web")?.typeOf, "Component");
  assert.equal(model.resolve("host")?.typeOf, "Node");
});

test("each entity carries its own file's conforms viewpoint", () => {
  const { model } = checkAgainst([], [fileA, fileB]);
  assert.equal(model.resolve("web")?.attrs.get("conforms"), "ComponentView");
  assert.equal(model.resolve("host")?.attrs.get("conforms"), "DeploymentView");
});
