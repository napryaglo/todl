import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON, fromJSON } from "../json.js";

// A boolean scalar survives model.json serialization as a real JSON boolean —
// the property the Plexus shelf reads (`shelf { visible }`) round-trips.
test("a boolean annotation param round-trips through JSON as a boolean", () => {
  const { model } = check([{ uri: "a.todl", text:
    `namespace acme {
      concept Actor { label : string; }
      annotation Shelf { visible : boolean; }
      taxonomy Actors : represents Actor {
        annotate Shelf { visible = true; }
        term Internal { label = "Internal"; }
      }
    }` }]);

  const json = toJSON(model);
  const app = json.nodes.find((n) => n.id === "actors@shelf");
  assert.equal(app!.attrs.visible, true);
  assert.equal(typeof app!.attrs.visible, "boolean");

  const restored = fromJSON(json);
  assert.equal(restored.resolve("actors@shelf")!.attrs.get("visible"), true);
});
