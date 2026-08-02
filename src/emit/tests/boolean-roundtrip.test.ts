import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON, fromJSON } from "../json.js";

// A boolean scalar survives model.json serialization as a real JSON boolean —
// the property the Plexus toolbox reads (`toolbox { visible }`) round-trips.
test("a boolean annotation param round-trips through JSON as a boolean", () => {
  const { model } = check([{ uri: "a.todl", text:
    `namespace acme {
      concept actor { label : string; }
      annotation toolbox { visible : boolean; }
      taxonomy actors : represents actor {
        annotate toolbox { visible = true; }
        term internal { label = "Internal"; }
      }
    }` }]);

  const json = toJSON(model);
  const app = json.nodes.find((n) => n.id === "actors@toolbox");
  assert.equal(app!.attrs.visible, true);
  assert.equal(typeof app!.attrs.visible, "boolean");

  const restored = fromJSON(json);
  assert.equal(restored.resolve("actors@toolbox")!.attrs.get("visible"), true);
});
