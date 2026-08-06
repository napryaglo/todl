import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { Tier, EdgeKind, Direction } from "../../model/graph.js";
import { MetaKind } from "../../model/kinds.js";

const SRC = `namespace acme {
  concept Component { name : string; }
  model prod : acme uses AwsCatalog {
    Component checkout { name = "Checkout"; }
  }
}`;

test("a model loads as an Instance-tier MetaKind.Model node with binding attrs", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  const node = model.resolve("prod");
  assert.ok(node);
  assert.equal(node!.tier, Tier.Instance);
  assert.equal(node!.typeOf, MetaKind.Model);
  assert.equal(node!.attrs.get("MetaModel"), "acme");
  assert.equal(node!.attrs.get("uses.count"), 1);
  assert.equal(node!.attrs.get("uses.0"), "AwsCatalog");
});

test("the model contains its objects via Contains", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  const contained = model.related("prod", EdgeKind.Contains, Direction.Out);
  assert.deepEqual(contained, ["checkout"]);
});

test("every loaded node carries its source namespace as provenance", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  assert.equal(model.resolve("prod")!.attrs.get("namespace"), "acme");
  assert.equal(model.resolve("checkout")!.attrs.get("namespace"), "acme");
  assert.equal(model.resolve("component")!.attrs.get("namespace"), "acme");
});
