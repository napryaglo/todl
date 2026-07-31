import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON, fromJSON } from "../json.js";
import { Tier } from "../../model/graph.js";
import { MetaKind } from "../../model/kinds.js";

test("a model node and namespace provenance survive toJSON/fromJSON", () => {
  const { model } = check([{ uri: "a.todl", text:
    `namespace acme {
      concept component { name : string; }
      model prod : acme uses lib { component checkout { name = "C"; } }
    }` }]);
  const restored = fromJSON(toJSON(model));

  const node = restored.resolve("prod");
  assert.ok(node);
  assert.equal(node!.tier, Tier.Instance);
  assert.equal(node!.typeOf, MetaKind.Model);
  assert.equal(node!.attrs.get("meta-model"), "acme");
  assert.equal(node!.attrs.get("uses.0"), "lib");
  assert.equal(node!.attrs.get("namespace"), "acme");
  assert.equal(restored.resolve("checkout")!.attrs.get("namespace"), "acme");
});
