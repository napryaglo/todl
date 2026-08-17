import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";

// A meta-model + model authored across two files: the endpoints live in
// structure.todl, the reified `a ~> b` connector is authored in flow.todl.
const structure = { uri: "structure.todl", text: `namespace t {
  concept endpoint { label : string; }
  concept connector { from : endpoint; to : endpoint; }
  operator ~> : connector (from, to);
  model M : t { endpoint a {} endpoint b {} }
}` };
const flow = { uri: "flow.todl", text: `namespace t {
  model M : t { a ~> b; }
}` };

test("load records the origin file of every own node — named and minted", () => {
  const { provenance } = load([structure, flow], new FakeIdGenerator());
  assert.equal(provenance.get("a"), "structure.todl");   // named instance
  assert.equal(provenance.get("b"), "structure.todl");
  assert.equal(provenance.get("id-0"), "flow.todl");     // minted connector homed to flow.todl, NOT structure
});

test("a single-file load homes named and minted ids to that file", () => {
  const src = { uri: "one.todl", text: `namespace t {
    concept endpoint { label : string; }
    concept connector { from : endpoint; to : endpoint; }
    operator ~> : connector (from, to);
    model M : t { endpoint a {} endpoint b {} a ~> b; }
  }` };
  const { provenance } = load([src], new FakeIdGenerator());
  assert.equal(provenance.get("a"), "one.todl");
  assert.equal(provenance.get("id-0"), "one.todl");
});
