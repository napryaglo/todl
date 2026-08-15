import type { IdGenerator } from "../id-generator.js";

/** Deterministic id source for reproducible loader/emitter tests. */
export class FakeIdGenerator implements IdGenerator {
  private n = 0;
  next(): string { return `id-${this.n++}`; }
}
