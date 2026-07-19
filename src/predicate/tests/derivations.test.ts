import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { THIS, variable, member, comprehension, isIn } from "../ast.js";

function techModel(): Repository {
  const model = new Repository();
  const builder = model.builder();
  builder.assertInstance("capability", "ui-framework");
  builder.assertInstance("capability", "http-api");
  builder.assertInstance("technology", "react");
  builder.assertInstance("technology", "vue");
  builder.assertInstance("technology", "express");
  builder.addRelationship("react", "provides", "ui-framework");
  builder.addRelationship("vue", "provides", "ui-framework");
  builder.addRelationship("express", "provides", "http-api");
  builder.assertInstance("frontend", "shop-web");
  builder.addRelationship("shop-web", "kind", "ui-framework");
  builder.commit();
  return model;
}

// { t: technology | this.kind in t.provides }
const implementableBy = comprehension(
  "t",
  "technology",
  isIn(member(THIS, "kind"), member(variable("t"), "provides")),
);

test("a derived member computes lazily and is queryable per instance", () => {
  const model = techModel();
  model.defineDerived("implementable-by", implementableBy);

  assert.deepEqual(
    new Set(model.derived("shop-web", "implementable-by")),
    new Set(["react", "vue"]),
  );
});

test("a derived result is recomputed after a change invalidates the cache", () => {
  const model = techModel();
  model.defineDerived("implementable-by", implementableBy);

  assert.deepEqual(
    new Set(model.derived("shop-web", "implementable-by")),
    new Set(["react", "vue"]),
  );

  // A new ui-framework technology should appear on the next query.
  model.builder().assertInstance("technology", "svelte").addRelationship("svelte", "provides", "ui-framework").commit();

  assert.deepEqual(
    new Set(model.derived("shop-web", "implementable-by")),
    new Set(["react", "vue", "svelte"]),
  );
});

test("querying an unknown derived member throws", () => {
  const model = techModel();
  assert.throws(() => model.derived("shop-web", "nonexistent"), /unknown derived member/i);
});
