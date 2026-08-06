import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompiledPackage } from "../publish.js";
import { publish } from "../publish.js";
import type { PackageStore } from "../stores.js";

function spyStore() {
  const seen: CompiledPackage[] = [];
  const store: PackageStore = { persist: async (p) => void seen.push(p) };
  return { store, seen };
}

const GOOD = `namespace ea { concept Technology { label : string; } }`;
const BAD = `namespace x { concept C { f : NonexistentType; } }`;

test("publish persists on a clean compile", async () => {
  const { store, seen } = spyStore();
  const out = await publish([], [{ uri: "ea.todl", text: GOOD }], store, { id: "ea", version: "0.1.0" });
  assert.equal(out.ok, true);
  assert.equal(out.persisted, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.id, "ea");
});

test("publish does NOT persist a failing compile", async () => {
  const { store, seen } = spyStore();
  const out = await publish([], [{ uri: "x.todl", text: BAD }], store, { id: "x", version: "0.1.0" });
  assert.equal(out.ok, false);
  assert.equal(out.persisted, false);
  assert.equal(seen.length, 0);
});
