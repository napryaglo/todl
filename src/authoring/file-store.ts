/**
 * A file-backed model store (design: model emitter + file store). Persists a
 * ModelDraft as `.todl` source through a FileIO seam and reloads it via the
 * parser. TODL owns only the seam — the concrete node:fs / IStorage adapter is a
 * consumer concern, so TODL stays environment-agnostic.
 */

import { Repository } from "../model/model.js";
import { toJSON } from "../emit/json.js";
import { checkAgainst } from "../api.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { ModelDraft } from "./model-draft.js";

/** Read/write the underlying file. Back it with node:fs, Plexus IStorage, etc. */
export interface FileIO {
  read(): Promise<string>;
  write(content: string): Promise<void>;
}

export class TodlFileStore {
  constructor(
    private readonly io: FileIO,
    private readonly bases: readonly Repository[],
    private readonly opts: { namespace: string },
  ) {}

  /** Serialize the draft to `.todl` and write it. */
  async save(draft: ModelDraft): Promise<void> {
    await this.io.write(draft.toTodl());
  }

  /** Read the `.todl` and reparse it against the bases. */
  async load(): Promise<{ model: Repository; diagnostics: Diagnostic[] }> {
    const text = await this.io.read();
    return checkAgainst(
      this.bases.map((b) => toJSON(b)),
      [{ uri: `${this.opts.namespace}.todl`, text }],
    );
  }
}
