import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";

// A boolean-valued annotation param (the toolbox `visible` case) stages as a real
// boolean scalar attr — not a relationship to a node named "true".
test("a boolean annotation param stages as a boolean scalar", () => {
  const { model, diagnostics } = load([{ uri: "a.todl", text: `namespace tech {
    concept actor { label : string; }
    annotation toolbox { visible : boolean; }
    taxonomy actors : represents actor {
      annotate toolbox { visible = true; }
      term internal { label = "Internal"; }
    }
  }` }]);
  assert.deepEqual(diagnostics, [], "clean load — visible=true is not an undefined reference");
  const app = model.resolve("actors@toolbox");
  assert.equal(app!.attrs.get("visible"), true);
  assert.equal(typeof app!.attrs.get("visible"), "boolean");
});

test("a boolean field on a term stages as a boolean scalar", () => {
  const { model } = load([{ uri: "a.todl", text: `namespace tech {
    concept flag { on : boolean; }
    taxonomy flags : represents flag {
      flag off-by-default { on = false; }
    }
  }` }]);
  assert.equal(model.resolve("flags.off-by-default")!.attrs.get("on"), false);
});
