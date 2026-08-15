/** A seam for minting node ids. Injected at load so the parser stays pure. */
export interface IdGenerator {
  next(): string;
}

/**
 * Snowflake-like ids: `o` + base36(timestamp ms) + base36(sequence, 3-wide).
 * Unique and monotonically increasing within a run; identifier-safe (leading
 * letter) so an id is a legal node id. Not reproducible across runs — stability
 * comes from persisting the id (the emitter writes it back), not from the
 * generator. Tests inject a deterministic FakeIdGenerator instead.
 */
export class SnowflakeIdGenerator implements IdGenerator {
  private lastMs = 0;
  private seq = 0;

  next(): string {
    let ms = Date.now();
    if (ms <= this.lastMs) { this.seq += 1; ms = this.lastMs; }
    else { this.lastMs = ms; this.seq = 0; }
    return `o${ms.toString(36)}${this.seq.toString(36).padStart(3, "0")}`;
  }
}
