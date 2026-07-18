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
  assert.match(js, /kind: "task",/);
});

test("emits field schema with cardinality text, omitting required-single", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn" });
  // `label : string;` is required-single — no cardinality key.
  assert.match(js, /label: \{ type: "string" \},/);
  // `assignee : string?;` is optional.
  assert.match(js, /assignee: \{ type: "string", cardinality: "0\.\.1" \},/);
});

test("emits relationship schema with target and cardinality", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn" });
  assert.match(js, /"lives-in": \{ target: "lane", cardinality: "1\.\.1" \},/);
  assert.match(js, /incoming: \{ target: "sequence-flow", cardinality: "\*" \},/);
});

test("emits enum tables with labels and a has() helper", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn" });
  assert.match(js, /export const TaskType = \{/);
  assert.match(js, /slug: "task-type",/);
  assert.match(js, /service: \{ id: "service", label: "Service Task" \},/);
  assert.match(js, /has\(value, member\) \{/);
});

test("emits the registry aggregating concepts, constructors, and enums", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn", rootConcept: "process" });
  assert.match(js, /export const bpmn = \{/);
  assert.match(js, /slug: "bpmn",/);
  assert.match(js, /rootConcept: "process",/);
  assert.match(js, /task: Task\.schema,/);
  assert.match(js, /task: data => \{ const o = new Task\(\);/);
  assert.match(js, /"task-type": TaskType,/);
});

test("concepts and enums are emitted in a deterministic (sorted) order", () => {
  const js = toMetaModule(corpus(), { slug: "bpmn" });
  assert.ok(js.indexOf("class Event") < js.indexOf("class Task"), "Event before Task");
  assert.ok(js.indexOf("const EventType") < js.indexOf("const TaskType"), "EventType before TaskType");
});
