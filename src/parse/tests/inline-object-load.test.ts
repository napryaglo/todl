import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { Severity } from "../../diagnostics/diagnostic.js";

/** Wrap a model body in a single-namespace source with the slot/component schema. */
function loadModel(instances: string, gen = new FakeIdGenerator()) {
  const src = `namespace t {
    concept slot { environment : string; }
    concept component { slots : slot[]; primary : slot?; }
    model M : t { ${instances} }
  }`;
  return load([{ uri: "t.todl", text: src }], gen);
}

test("a minted inline object is a contained, field-bound node", () => {
  const { model, diagnostics } = loadModel(`component c1 { primary = slot { environment = "prod"; }; }`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
  assert.ok(model.resolve("id-0"), "inline node id-0 exists");
  assert.equal(model.resolve("id-0")?.attrs.get("environment"), "prod");
  assert.ok(model.related("c1", EdgeKind.Contains, Direction.Out).includes("id-0"));
  assert.deepEqual(model.refs("c1", "primary"), ["id-0"]);
});

test("an author-supplied id is reused (not minted)", () => {
  const { model } = loadModel(`component c1 { primary = slot { id = keep_me; environment = "dev"; }; }`);
  assert.ok(model.resolve("keep_me"), "author id reused");
  assert.deepEqual(model.refs("c1", "primary"), ["keep_me"]);
});

test("a list of inline objects binds each, in order", () => {
  const { model } = loadModel(`component c1 { slots = [ slot { environment = "a"; }, slot { environment = "b"; } ]; }`);
  assert.deepEqual(model.refs("c1", "slots"), ["id-0", "id-1"]);
  assert.equal(model.resolve("id-1")?.attrs.get("environment"), "b");
});
