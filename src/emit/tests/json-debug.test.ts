import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { toJSON } from "../json.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";

const SRC = `namespace app {
  concept Component { label : string; }
  model M : app { Component c { label = "x"; } }
}`;

function compile() {
  const { model, diagnostics, provenance } = check(
    [{ uri: "app.todl", text: SRC }],
    new FakeIdGenerator(),
  );
  assert.deepEqual(diagnostics.map((d) => d.message), [], "sample compiles clean");
  return { model, provenance };
}

test("debug off (default): nodes/edges carry no debug block — wire form unchanged", () => {
  const { model } = compile();
  const doc = toJSON(model);
  assert.ok(doc.nodes.every((n) => n.debug === undefined), "no node.debug");
  assert.ok(doc.edges.every((e) => e.debug === undefined), "no edge.debug");
});

test("debug on: concept/field/model/instance carry readable kind + name + type + namespace", () => {
  const { model } = compile();
  const doc = toJSON(model, { debug: true });
  const byId = (id: string) => doc.nodes.find((n) => n.id === id);

  assert.deepEqual(byId("Component")?.debug, {
    kind: "concept", name: "Component", type: "concept", namespace: "app",
  });
  assert.deepEqual(byId("Component.label")?.debug, {
    kind: "field", name: "label", type: "field", namespace: "app",
  });
  assert.deepEqual(byId("M")?.debug, {
    kind: "model", name: "M", type: "model", namespace: "app",
  });
  // The interesting one: an instance names the concept it instantiates.
  assert.deepEqual(byId("c")?.debug, {
    kind: "instance", name: "c", type: "Component", namespace: "app",
  });
});

test("debug on: edges carry readable from/to (behind the opaque endpoint ids)", () => {
  const { model } = compile();
  const doc = toJSON(model, { debug: true });
  const contains = doc.edges.find((e) => e.kind === "Contains" && e.from === "M");
  assert.deepEqual(contains?.debug, { from: "M", to: "c" });
  const hasField = doc.edges.find((e) => e.kind === "HasField" && e.from === "Component");
  assert.deepEqual(hasField?.debug, { from: "Component", to: "label" });
});

test("debug on with provenance: node.debug.source is the origin uri", () => {
  const { model, provenance } = compile();
  const doc = toJSON(model, { debug: true, provenance });
  // Instances/models are homed in provenance; concepts may not be.
  const m = doc.nodes.find((n) => n.id === "M");
  assert.equal(m?.debug?.source, "app.todl");
});
