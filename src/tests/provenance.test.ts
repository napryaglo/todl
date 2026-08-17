import { test } from "node:test";
import assert from "node:assert/strict";

import { check, checkAgainst } from "../api.js";
import { toJSON } from "../emit/json.js";

// Meta-model with a reified `~>` connector; an arch model authors `a ~> b`.
const meta = { uri: "mm.todl", text: `namespace mm {
  concept endpoint { label : string; }
  concept connector { from : endpoint; to : endpoint; }
  operator ~> : connector (from, to);
  viewpoint Flow : frames connector
}` };

test("checkAgainst surfaces the origin file of a minted reified edge", () => {
  const base = toJSON(check([meta]).model);
  const src = { uri: "flow.todl", text: `namespace acme {
    import mm;
    model Arch : mm conforms Flow { endpoint a {} endpoint b {} a ~> b; }
  }` };
  const { model, provenance } = checkAgainst([base], [src]);
  // The minted connector is the sole own node of typeOf "connector".
  const connector = model.allNodes().find((n) => n.typeOf === "connector");
  assert.ok(connector, "a connector node was minted");
  assert.equal(provenance.get(connector.id), "flow.todl");
});

test("check returns a provenance map for named instances", () => {
  const { provenance } = check([{ uri: "one.todl", text: `namespace t {
    concept box {}
    model M : t { box a {} }
  }` }]);
  assert.equal(provenance.get("a"), "one.todl");
});
