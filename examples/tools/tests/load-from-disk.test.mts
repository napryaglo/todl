import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadExamplesFromDisk } from "../load-from-disk.mjs";
import { verifyExample } from "../../../shared/verify.js";

const examplesRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("loads the fixture example with sources", () => {
  const entries = loadExamplesFromDisk(examplesRoot);
  const fx = entries.find((e) => e.manifest.id === "fixture-clean-instance");
  assert.ok(fx, "fixture should load");
  assert.equal(fx!.sources.length, 1);
  assert.match(fx!.sources[0]!.text, /concept Component/);
  assert.ok(fx!.dir.startsWith("_fixture/"));
});

test("the committed fixture golden verifies clean", () => {
  const fx = loadExamplesFromDisk(examplesRoot).find((e) => e.manifest.id === "fixture-clean-instance")!;
  assert.equal(verifyExample(fx).status, "pass");
  assert.equal(fx.golden.diagnostics.length, 0);
});
