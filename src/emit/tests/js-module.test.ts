import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { load as loadFiles } from "../../parse/loader.js";
import { toMetaModule } from "../js-module.js";

/** Test shim: wrap raw source strings as SourceFiles and return the model. */
function load(texts: string[]) {
  return loadFiles(texts.map((text, i) => ({ uri: `s${i}.todl`, text }))).model;
}

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../parse/tests/fixtures/${name}`, import.meta.url)),
    "utf8",
  );
}

function corpus() {
  return load([
    fixture("primitives.todl"),
    fixture("enums.todl"),
    fixture("concepts.todl"),
    fixture("order-fulfillment.todl"),
  ]);
}

test("emits ModelElement subclasses for each concept", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn" });
  assert.match(js, /import \{ ModelElement \} from "todl-runtime\/model-element\.js";/);
  assert.match(js, /export class Task extends ModelElement \{/);
  assert.match(js, /export class Event extends ModelElement \{/);
  assert.match(js, /kind: "Task",/);
});

test("emits a taxonomy table (terms with parent) and a taxonomies registry key", () => {
  const model = load([
    `namespace n { concept Thing {} taxonomy Cc : represents Thing { term Surface { label = "Surface"; term ApiService { label = "API"; } } } }`,
  ]);
  const js = toMetaModule(model, { slug: "n" });
  assert.match(js, /export const Cc = \{/);
  assert.match(js, /represents: \["Thing"\],/);
  assert.match(js, /terms: \{/);
  assert.match(js, /ApiService: \{[^}]*parent: "Surface"/);
  assert.match(js, /taxonomies: \{/);
});

test("emits a multi-representation taxonomy's represents as a list", () => {
  const model = load([
    `namespace n { concept Location {} concept Technology {}
      taxonomy Microsoft : represents Location, Technology {
        Location azure {} Technology azureOpenai {}
      } }`,
  ]);
  const js = toMetaModule(model, { slug: "n" });
  assert.match(js, /represents: \["Location", "Technology"\],/);
});

test("emits field schema with cardinality text, omitting required-single", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn" });
  // `label : string;` is required-single — no cardinality key.
  assert.match(js, /label: \{ type: "string" \},/);
  // `assignee : string?;` is optional.
  assert.match(js, /assignee: \{ type: "string", cardinality: "0\.\.1" \},/);
});

test("emits relationship schema with targets and cardinality", () => {
  // Targets are `Targets` edges to resolved concepts; a self-contained model
  // keeps `Lane`/`SequenceFlow` defined so the edges survive (unresolved
  // targets are dropped at commit — see the reference-integrity program).
  const model = load([
    `namespace n { concept Lane {} concept SequenceFlow {}
      concept Task { relationship livesIn -> Lane; relationship incoming -> SequenceFlow[]; } }`,
  ]);
  const js = toMetaModule(model, { slug: "n" });
  assert.match(js, /livesIn: \{ targets: \["Lane"\], cardinality: "1\.\.1" \},/);
  assert.match(js, /incoming: \{ targets: \["SequenceFlow"\], cardinality: "\*" \},/);
});

test("emits taxonomy tables with labels and a has() helper", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn" });
  assert.match(js, /export const TaskType = \{/);
  assert.match(js, /slug: "TaskType",/);
  assert.match(js, /Service: \{ id: "Service", label: "Service Task", parent: null, children: \[\] \},/);
  assert.match(js, /has\(value, member\) \{/);
});

test("emits the registry aggregating concepts, constructors, and enums", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn", rootConcept: "process" });
  assert.match(js, /export const bpmn = \{/);
  assert.match(js, /slug: "bpmn",/);
  assert.match(js, /rootConcept: "process",/);
  assert.match(js, /Task: Task\.schema,/);
  assert.match(js, /Task: data => \{ const o = new Task\(\);/);
  assert.match(js, /TaskType: TaskType,/);
});

test("concepts and enums are emitted in a deterministic (sorted) order", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn" });
  assert.ok(js.indexOf("class Event") < js.indexOf("class Task"), "Event before Task");
  assert.ok(js.indexOf("const EventType") < js.indexOf("const TaskType"), "EventType before TaskType");
});
