import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { ModelDraft } from "../model-draft.js";

// Meta-model: endpoints framed by Structure, reified connectors by Flow.
function base() {
  return check([{ uri: "mm.todl", text: `namespace mm {
    concept endpoint { label : string?; }
    concept connector { from : endpoint; to : endpoint; }
    operator ~> : connector (from, to);
    viewpoint Structure : frames endpoint
    viewpoint Flow : frames connector
  }` }]).model;
}

const structure = { uri: "structure.todl", text: `namespace acme {
  import mm;
  model Arch : mm conforms Structure { endpoint a {} endpoint b {} }
}` };
const flow = { uri: "flow.todl", text: `namespace acme {
  import mm;
  model Arch : mm conforms Flow { a ~> b; }
}` };

// The typeOf of an own instance (Entity exposes id; typeOf lives on the resolved node).
function ownOfType(draft: ModelDraft, typeOf: string): string | undefined {
  return draft.ownInstances().map((e) => e.id).find((id) => draft.resolve(id)?.typeOf === typeOf);
}

test("a minted reified edge is homed to the file that authored it", () => {
  const draft = ModelDraft.fromSources([base()], [structure, flow], { namespace: "acme" });
  const connectorId = ownOfType(draft, "connector");
  assert.ok(connectorId, "connector materialised");
  assert.equal(draft.homeOf(connectorId), "flow.todl");
});

test("toTodlByFile keeps the reified edge in its origin file — no default-file spill", () => {
  const draft = ModelDraft.fromSources([base()], [structure, flow], { namespace: "acme" });
  const files = draft.toTodlByFile();
  // The step stays in flow.todl; NO stray acme.todl default file is created.
  assert.deepEqual([...files.keys()].sort(), ["flow.todl", "structure.todl"]);
  assert.match(files.get("flow.todl")!, /~>/);
  assert.match(files.get("structure.todl")!, /endpoint a/);
});

test("an inline object is homed to the file that authored it", () => {
  const inlineBase = check([{ uri: "mm.todl", text: `namespace mm {
    concept endpoint { label : string?; }
    concept box { body : endpoint; }
    viewpoint V : frames box
  }` }]).model;
  const inline = { uri: "inline.todl", text: `namespace acme {
    import mm;
    model Arch : mm conforms V { box outer { body = endpoint {}; } }
  }` };
  const draft = ModelDraft.fromSources([inlineBase], [inline], { namespace: "acme" });
  const files = draft.toTodlByFile();
  // Everything (outer + its minted inline endpoint) stays in inline.todl.
  assert.deepEqual([...files.keys()], ["inline.todl"]);
});
