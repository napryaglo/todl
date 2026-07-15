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

test("loads a meta-model descriptor with numeric and list members", () => {
  const model = load([
    `namespace d {
      meta-model enterprise-architecture {
        name = "EA";
        version = 5;
        root-concept = model;
        top-level-concepts = [ component, location ];
      }
      concept model { label : string; }
      concept component { label : string; }
      concept location { label : string; }
    }`,
  ]);
  assert.ok(model.has("enterprise-architecture"));
  assert.equal(model.resolve("enterprise-architecture")?.attrs.get("version"), "5");
});

test("edge-shorthand connector loads from/to as relationship edges", () => {
  const model = load([
    `namespace d {
      component business-agent { label = "x"; }
      component agent-orchestrator { label = "y"; }
      connector &business-agent -> &agent-orchestrator { type = enabled-by; }
    }`,
  ]);
  const conn = model.allNodes().find((n) => n.typeOf === "connector");
  assert.ok(conn);
  assert.deepEqual(model.related(conn!.id, EdgeKind.Relationship, Direction.Out, "from"), ["business-agent"]);
  assert.deepEqual(model.related(conn!.id, EdgeKind.Relationship, Direction.Out, "to"), ["agent-orchestrator"]);
});

test("nested instances load with contains edges and a meta-model binding", () => {
  const model = load([
    `namespace d {
      model m : enterprise-architecture {
        title = "T";
        location saas-3p { label = "x"; }
      }
    }`,
  ]);
  assert.equal(model.resolve("saas-3p")?.typeOf, "location");
  assert.deepEqual(model.related("m", EdgeKind.Contains, Direction.Out), ["saas-3p"]);
  assert.equal(model.resolve("m")?.attrs.get("meta-model"), "enterprise-architecture");
});

test("a |-composed enum-flag value loads as the legacy scalar string", () => {
  const model = load([
    `namespace d { location on-prem { type = physical | on-premises | logical-grouping; } }`,
  ]);
  assert.equal(model.resolve("on-prem")?.attrs.get("type"), "physical | on-premises | logical-grouping");
});

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
