import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { ModelDraft } from "../model-draft.js";

// A meta-model base: concepts + viewpoints the arch files draw on.
function base() {
  return check([{
    uri: "mm.todl",
    text: `namespace mm {
      concept Component {}
      concept Node {}
      viewpoint ComponentView : frames Component
      viewpoint DeploymentView : frames Node, Component
    }`,
  }]).model;
}

const fileA = { uri: "components.todl", text: `namespace acme {
  import mm;
  model Arch : mm conforms ComponentView { Component web {} }
}` };
const fileB = { uri: "deployments.todl", text: `namespace acme {
  import mm;
  model Arch : mm conforms DeploymentView { Node host {} }
}` };

test("fromSources composes many files into one draft", () => {
  const draft = ModelDraft.fromSources([base()], [fileA, fileB], { namespace: "acme" });
  assert.equal(draft.resolve("web")?.typeOf, "Component");
  assert.equal(draft.resolve("host")?.typeOf, "Node");
});

test("homeOf maps each entity to its source file", () => {
  const draft = ModelDraft.fromSources([base()], [fileA, fileB], { namespace: "acme" });
  assert.equal(draft.homeOf("web"), "components.todl");
  assert.equal(draft.homeOf("host"), "deployments.todl");
});
