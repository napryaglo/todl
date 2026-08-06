import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryGraphStore } from "../../model/graph-store.js";
import type { CompiledPackage } from "../publish.js";
import { GraphPackageStore } from "../stores.js";

function pkg(): CompiledPackage {
  return {
    id: "ms",
    version: "1.0.0",
    document: {
      nodes: [
        { id: "ms.a", tier: "Instance", typeOf: "t", attrs: { id: "a", label: "A" } },
        { id: "ms.b", tier: "Instance", typeOf: "t", attrs: { id: "b" } },
      ],
      edges: [{ kind: "Relationship", via: "rel", from: "ms.a", to: "ms.b" }],
    },
    sources: [],
    classes: [],
  };
}

test("GraphPackageStore loads every compiled node + edge into the GraphStore", async () => {
  const store = new InMemoryGraphStore();
  await new GraphPackageStore(store).persist(pkg());
  assert.equal(store.nodeCount, 2);
  assert.ok(store.hasNode("ms.a"));
  assert.equal(store.getNode("ms.a")?.attrs.get("label"), "A");
  assert.equal(store.outEdges("ms.a").length, 1);
});
