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

test("toTodlByFile emits one file per home, each with its conforms clause", () => {
  const draft = ModelDraft.fromSources([base()], [fileA, fileB], { namespace: "acme" });
  const files = draft.toTodlByFile();
  assert.deepEqual([...files.keys()].sort(), ["components.todl", "deployments.todl"]);
  const a = files.get("components.todl")!;
  assert.match(a, /conforms ComponentView/);
  assert.match(a, /Component web/);
  assert.doesNotMatch(a, /conforms\s*=/); // conforms is a block clause, not an entity field
  const b = files.get("deployments.todl")!;
  assert.match(b, /conforms DeploymentView/);
  assert.match(b, /Node host/);
});

test("the emitted files round-trip: recompiling reproduces the model, no diagnostics", () => {
  const draft = ModelDraft.fromSources([base()], [fileA, fileB], { namespace: "acme" });
  const files = draft.toTodlByFile();
  const sources = [...files.entries()].map(([uri, text]) => ({ uri, text }));
  const { model, diagnostics } = check([
    { uri: "mm.todl", text: `namespace mm {
      concept Component {}
      concept Node {}
      viewpoint ComponentView : frames Component
      viewpoint DeploymentView : frames Node, Component
    }` },
    ...sources,
  ]);
  assert.deepEqual(diagnostics.map((d) => d.code), []);
  assert.equal(model.resolve("web")?.typeOf, "Component");
  assert.equal(model.resolve("host")?.typeOf, "Node");
});

test("create with a home hint places a new entity into that file's output", () => {
  const draft = ModelDraft.fromSources([base()], [fileA, fileB], { namespace: "acme" });
  draft.create("Component", "api", "components.todl");
  assert.equal(draft.homeOf("api"), "components.todl");
  const files = draft.toTodlByFile();
  assert.match(files.get("components.todl")!, /Component api/);
});
