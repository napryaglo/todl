import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";
import { Repository } from "../../model/model.js";
import { toJSON, type TodlDocument } from "../json.js";
import { collectOperators, deriveBindings, emitModelTodl } from "../todl.js";
import { EdgeKind, Direction } from "../../model/graph.js";

const SRC = `namespace t {
  concept endpoint { label : string; }
  concept connector { from : endpoint; to : endpoint; }
  operator ~> : connector (from, to);
  model M : t { endpoint a { label = "a"; } endpoint b { label = "b"; } a ~> b; }
}`;

test("collectOperators reverse-maps a concept to its first operator", () => {
  const { model } = check([{ uri: "t.todl", text: SRC }], new FakeIdGenerator());
  const ops = collectOperators(model);
  assert.equal(ops.get("connector")?.glyph, "~>");
  assert.equal(ops.get("connector")?.from, "from");
  assert.equal(ops.get("connector")?.to, "to");
});

test("a reified edge materializes as a connector binding a->b", () => {
  const { model } = check([{ uri: "t.todl", text: SRC }], new FakeIdGenerator());
  assert.deepEqual(model.related("id-0", EdgeKind.Relationship, Direction.Out, "from"), ["a"]);
  assert.deepEqual(model.related("id-0", EdgeKind.Relationship, Direction.Out, "to"), ["b"]);
});

// A meta-model base with a `~>` operator over a reified `connector` concept.
function base(): Repository {
  const r = new Repository();
  const b = r.builder().setNamespace("acme.ea");
  b.definePrimitive("string");
  b.defineConcept("endpoint");
  b.addField("endpoint", "label", "string");
  b.defineConcept("connector");
  b.addField("connector", "from", "endpoint");
  b.addField("connector", "to", "endpoint");
  b.defineOperator("~>", "connector", "from", "to", null);
  b.commit();
  return r;
}

test("a reified edge emits as operator shorthand, not a flattened record", () => {
  const model = base();
  const baseIds = new Set(model.allNodes().map((n) => n.id));
  const b = model.builder();
  b.assertInstance("endpoint", "a");
  b.assertInstance("endpoint", "b");
  b.assertInstance("connector", "id-0");
  b.setField("id-0", "id", "id-0");
  b.addRelationship("id-0", "from", "a");
  b.addRelationship("id-0", "to", "b");
  b.commit();

  const own: TodlDocument = { nodes: [], edges: [] };
  const full = toJSON(model);
  for (const n of full.nodes) if (!baseIds.has(n.id)) own.nodes.push(n);
  for (const e of full.edges) if (!baseIds.has(e.from)) own.edges.push(e);

  const bindings = deriveBindings(model, baseIds, "acme.app", own);
  const out = emitModelTodl(own, "acme.app", bindings, undefined, collectOperators(model));
  assert.match(out, /a ~> b;/, "shorthand form");
  assert.doesNotMatch(out, /connector id-0 \{/, "not a flattened connector record");
});
