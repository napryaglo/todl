import { test } from "node:test";
import assert from "node:assert/strict";

import { SnowflakeIdGenerator, type IdGenerator } from "../id-generator.js";

/** Deterministic id source for reproducible loader/emitter tests. */
export class FakeIdGenerator implements IdGenerator {
  private n = 0;
  next(): string { return `id-${this.n++}`; }
}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

test("snowflake ids are unique, monotonic, and identifier-safe", () => {
  const gen = new SnowflakeIdGenerator();
  const ids: string[] = [];
  for (let i = 0; i < 2000; i++) ids.push(gen.next());
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const id of ids) assert.ok(ID_RE.test(id), `identifier-safe: ${id}`);
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, "ids must be monotonically increasing");
});

test("FakeIdGenerator is deterministic", () => {
  const gen = new FakeIdGenerator();
  assert.deepEqual([gen.next(), gen.next(), gen.next()], ["id-0", "id-1", "id-2"]);
});
