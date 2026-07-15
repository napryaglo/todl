import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../../model/model.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { toJSON, fromJSON } from "../json.js";

function sample(): Model {
  const model = new Model();
  model
    .builder()
    .definePrimitive("string")
    .defineConcept("technology")
    .addField("technology", "label", "string")
    .assertInstance("technology", "react")
    .setField("react", "label", "React")
    .assertInstance("capability", "ui-framework")
    .addRelationship("react", "provides", "ui-framework")
    .commit();
  return model;
}

test("toJSON produces a plain, stringifiable document with enums serialized by name", () => {
  const doc = toJSON(sample());
  const json = JSON.stringify(doc); // must not throw

  assert.ok(json.includes('"Instance"'), "tier serialized by name");
  const react = doc.nodes.find((node) => node.id === "react");
  assert.equal(react?.tier, "Instance");
  assert.equal(react?.typeOf, "technology");
  assert.equal(react?.attrs["label"], "React");
});

test("fromJSON round-trips a model (nodes, attrs, edges, schema)", () => {
  const restored = fromJSON(toJSON(sample()));

  assert.equal(restored.resolve("react")?.attrs.get("label"), "React");
  assert.deepEqual(
    restored.related("react", EdgeKind.Relationship, Direction.Out, "provides"),
    ["ui-framework"],
  );
  assert.equal(restored.schemaOf("technology").fields[0]?.name, "label");
  assert.deepEqual(restored.instancesOf("technology"), ["react"]);
});
