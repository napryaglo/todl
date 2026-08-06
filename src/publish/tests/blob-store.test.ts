import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompiledPackage } from "../publish.js";
import { BlobPackageStore, type PackageSink } from "../stores.js";

function fakeSink() {
  const files = new Map<string, string>();
  const sink: PackageSink = { writeText: async (p, c) => void files.set(p, c) };
  return { sink, files };
}

function pkg(): CompiledPackage {
  return {
    id: "ms",
    version: "1.0.0",
    document: { nodes: [{ id: "ms.a", tier: "Instance", typeOf: "t", attrs: { id: "a" } }], edges: [] },
    sources: [{ uri: "ms.todl", text: "namespace ms {}" }],
    classes: [],
  };
}

test("BlobPackageStore writes model.json + src/<uri> under <id>/<version>", async () => {
  const { sink, files } = fakeSink();
  await new BlobPackageStore(sink).persist(pkg());
  assert.deepEqual(JSON.parse(files.get("ms/1.0.0/model.json")!), pkg().document);
  assert.equal(files.get("ms/1.0.0/src/ms.todl"), "namespace ms {}");
});

test("BlobPackageStore honours a custom layout", async () => {
  const { sink, files } = fakeSink();
  await new BlobPackageStore(sink, { layout: (id, v) => `packages/${id}@${v}` }).persist(pkg());
  assert.ok(files.has("packages/ms@1.0.0/model.json"));
});
