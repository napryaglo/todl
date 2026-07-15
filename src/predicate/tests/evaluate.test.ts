import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../../model/model.js";
import { evaluate, satisfies } from "../evaluate.js";
import {
  THIS,
  NONE,
  variable,
  member,
  comprehension,
  all,
  any,
  implies,
  neq,
  isIn,
} from "../ast.js";

/** react/vue provide ui-framework; express provides http-api; shop-web needs ui-framework. */
function techModel(reactAvailableIn: string[] = ["m365", "browser"]): Model {
  const model = new Model();
  const builder = model.builder();
  builder.assertInstance("capability", "ui-framework");
  builder.assertInstance("capability", "http-api");
  builder.assertInstance("location", "m365");
  builder.assertInstance("location", "browser");
  builder.assertInstance("technology", "react");
  builder.assertInstance("technology", "vue");
  builder.assertInstance("technology", "express");
  builder.addRelationship("react", "provides", "ui-framework");
  builder.addRelationship("vue", "provides", "ui-framework");
  builder.addRelationship("express", "provides", "http-api");
  for (const location of reactAvailableIn) {
    builder.addRelationship("react", "available-in", location);
  }
  builder.assertInstance("frontend", "shop-web");
  builder.addRelationship("shop-web", "kind", "ui-framework");
  builder.addRelationship("shop-web", "in", "m365");
  builder.addRelationship("shop-web", "implemented-by", "react");
  builder.commit();
  return model;
}

test("comprehension computes coverage over instances (implementable-by)", () => {
  const model = techModel();
  // { t: technology | this.kind in t.provides }
  const expr = comprehension("t", "technology", isIn(member(THIS, "kind"), member(variable("t"), "provides")));

  const result = evaluate(model, expr, "shop-web");

  assert.ok(result instanceof Set);
  assert.deepEqual(new Set(result as Set<string>), new Set(["react", "vue"]));
});

test("invariant holds when the implementing tech covers the location", () => {
  const model = techModel(["m365", "browser"]);
  // this.implemented-by != none implies this.in in this.implemented-by.available-in
  const expr = implies(
    neq(member(THIS, "implemented-by"), NONE),
    isIn(member(THIS, "in"), member(member(THIS, "implemented-by"), "available-in")),
  );

  assert.equal(satisfies(model, expr, "shop-web"), true);
});

test("invariant fails when the implementing tech does not cover the location", () => {
  const model = techModel(["browser"]); // react no longer available in m365
  const expr = implies(
    neq(member(THIS, "implemented-by"), NONE),
    isIn(member(THIS, "in"), member(member(THIS, "implemented-by"), "available-in")),
  );

  assert.equal(satisfies(model, expr, "shop-web"), false);
});

test("any/all quantify over a concept's instances", () => {
  const model = techModel();
  const someCovers = any("t", "technology", isIn(member(THIS, "kind"), member(variable("t"), "provides")));
  const allCover = all("t", "technology", isIn(member(THIS, "kind"), member(variable("t"), "provides")));

  assert.equal(satisfies(model, someCovers, "shop-web"), true); // react, vue
  assert.equal(satisfies(model, allCover, "shop-web"), false); // express does not
});
