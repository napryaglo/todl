// Pure data types shared by the corpus, verify, CLI, and (Phase 2) the app.
// No logic lives here — see verify.ts / corpus-access.ts.
import type { TodlDocument } from "@pragmatic-tech-ai/todl";

/** One source file inside an example; `name` is its load identity (uri). */
export interface ExampleSource { name: string; text: string; }

/** The hand-authored manifest (example.json). */
export interface ExampleManifest {
  id: string;
  title: string;
  group: string;
  order: number;
  tags: string[];
  /** Markdown shown above the snippet in the docs showcase. */
  narrative: string;
  /** Load order; each entry is a filename in the example folder. */
  files: string[];
  /** Files (subset of `files`) compiled as already-published bases. */
  bases?: string[];
  /** Human-readable intent flag; the golden is authoritative. */
  expectClean: boolean;
}

/** A diagnostic reduced to the stable fields we snapshot. */
export interface GoldenDiagnostic {
  code: string;
  severity: string;
  message: string;
  span: { uri: string; start: { line: number; column: number }; end: { line: number; column: number } } | null;
  path: string | null;
}

/** The committed expected output (golden.json), after canonicalization. */
export interface Golden {
  diagnostics: GoldenDiagnostic[];
  document: TodlDocument;
}

/** One corpus entry: manifest + sources + committed golden + on-disk dir. */
export interface CorpusEntry {
  manifest: ExampleManifest;
  sources: ExampleSource[];
  golden: Golden;
  /** Repo-relative folder, e.g. "examples/resolution/taxonomy-bare". Used by
   *  the node update tool to know where to write golden.json; ignored elsewhere. */
  dir: string;
}

export type VerifyStatus = "pass" | "fail" | "updated";

export interface VerifyResult {
  id: string;
  status: VerifyStatus;
  /** Present when status === "fail": a human-readable diff. */
  diff?: string;
  /** Present when status === "updated": the freshly computed golden to write. */
  golden?: Golden;
}

export interface VerifySummary {
  passed: number;
  failed: number;
  updated: number;
  results: VerifyResult[];
}
