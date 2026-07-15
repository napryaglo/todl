import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { load } from "../loader.js";
import { Cardinality, EdgeKind, Direction } from "../../model/graph.js";
import { DiagnosticCode } from "../../validate/validate.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

function corpus() {
  return load([
    fixture("primitives.todl"),
    fixture("enums.todl"),
    fixture("concepts.todl"),
    fixture("order-fulfillment.todl"),
  ]);
}

test("loads concept schemas from the corpus", () => {
  const model = corpus();
  const task = model.schemaOf("task");
  assert.equal(task.fields.find((field) => field.name === "assignee")?.cardinality, Cardinality.Optional);
  assert.equal(task.fields.find((field) => field.name === "label")?.type, "string");
  assert.equal(task.relationships.find((r) => r.name === "incoming")?.cardinality, Cardinality.Many);
  assert.equal(task.relationships.find((r) => r.name === "lives-in")?.cardinality, Cardinality.One);
});

test("loads enum case nodes", () => {
  const model = corpus();
  assert.ok(model.instancesOf("task-type").includes("service"));
  assert.ok(model.instancesOf("event-type").includes("start"));
});

test("loads instances with scalar attrs and relationship edges", () => {
  const model = corpus();
  assert.equal(model.resolve("validate-payment")?.typeOf, "task");
  assert.equal(model.resolve("validate-payment")?.attrs.get("label"), "Validate Payment");
  assert.deepEqual(
    model.related("validate-payment", EdgeKind.Relationship, Direction.Out, "type"),
    ["service"],
  );
  assert.deepEqual(
    model.related("order-placed", EdgeKind.Relationship, Direction.Out, "outgoing"),
    ["order-to-validate"],
  );
});

test("undefined references become unresolved placeholder nodes", () => {
  const model = corpus();
  assert.equal(model.resolve("message")?.typeOf, UNRESOLVED_TYPEOF);
});

const UNRESOLVED_TYPEOF = "unresolved";

test("the loaded process satisfies its invariants and target types", () => {
  const model = corpus();
  const diagnostics = model.validate();
  const blocking = diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === DiagnosticCode.InvariantFailed ||
      diagnostic.code === DiagnosticCode.TargetTypeMismatch,
  );
  assert.deepEqual(blocking, []);
});
