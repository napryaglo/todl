// Pure verification: compile an example, canonicalize its output into a stable
// "golden" shape, and diff against the committed snapshot. NO filesystem — the
// node update tool handles writes. This module must run in a browser (Phase 2).
import {
  check, checkAgainst, toJSON, toJSONOwn,
  type SourceFile, type Diagnostic, type TodlDocument, type Repository,
} from "@pragmatic-tech-ai/todl";
import type { CorpusEntry, Golden, GoldenDiagnostic, VerifyResult, VerifySummary } from "./corpus-types.js";

/** Deterministic id source. The compiler's default is Snowflake (wall-clock),
 *  and even the prelude is compiled with it, so ids differ every run. We inject
 *  this for the source AND canonically remap ALL ids in normalize (below), so
 *  prelude/base ids referenced by own nodes are stable too. */
export class DeterministicIdGenerator {
  private n = 0;
  next(): string { return `g${this.n++}`; }
}

function toSourceFiles(entry: CorpusEntry): { bases: SourceFile[]; sources: SourceFile[] } {
  const baseNames = new Set(entry.manifest.bases ?? []);
  const byName = new Map(entry.sources.map((s) => [s.name, s]));
  const bases: SourceFile[] = [];
  const sources: SourceFile[] = [];
  for (const name of entry.manifest.files) {
    const src = byName.get(name);
    if (!src) throw new Error(`example ${entry.manifest.id}: manifest lists "${name}" but no such source`);
    (baseNames.has(name) ? bases : sources).push({ uri: name, text: src.text });
  }
  return { bases, sources };
}

/** Rewrite every id in the document to a canonical placeholder, so goldens are
 *  independent of the compiler's (non-deterministic) id generator. Own nodes
 *  come first in emission order (`#n0..`); any remaining referenced ids
 *  (prelude/base) are numbered in first-appearance order (`#r0..`). */
function canonicalizeIds(doc: TodlDocument): TodlDocument {
  const map = new Map<string, string>();
  const own = (id: string): string => {
    let c = map.get(id);
    if (c === undefined) { c = `#n${map.size}`; map.set(id, c); }
    return c;
  };
  // Pass 1: own node ids in emission order.
  for (const node of doc.nodes) own(node.id);
  // Pass 2: referenced ids (typeOf, edge endpoints, via) — assigned after all
  // own ids, so own numbering never shifts when references change.
  const refs = new Map<string, string>();
  const ref = (id: string | null): string | null => {
    if (id === null) return null;
    if (map.has(id)) return map.get(id)!;
    let c = refs.get(id);
    if (c === undefined) { c = `#r${refs.size}`; refs.set(id, c); }
    return c;
  };
  const nodes = doc.nodes.map((n) => ({ id: map.get(n.id)!, tier: n.tier, typeOf: ref(n.typeOf)!, attrs: n.attrs }));
  const edges = doc.edges.map((e) => ({ kind: e.kind, via: ref(e.via), from: ref(e.from)!, to: ref(e.to)! }));
  return { nodes, edges };
}

function canonicalDoc(doc: TodlDocument): TodlDocument {
  const c = canonicalizeIds(doc);
  const nodes = [...c.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...c.edges].sort((a, b) =>
    (a.from + a.via + a.kind + a.to).localeCompare(b.from + (b.via ?? "") + b.kind + b.to));
  return { nodes, edges };
}

function canonicalDiagnostics(diags: readonly Diagnostic[]): GoldenDiagnostic[] {
  return diags
    .map((d): GoldenDiagnostic => ({
      code: d.code, severity: d.severity, message: d.message, path: d.path,
      span: d.span ? { uri: d.span.uri, start: d.span.start, end: d.span.end } : null,
    }))
    .sort((a, b) => {
      const ua = a.span?.uri ?? "", ub = b.span?.uri ?? "";
      if (ua !== ub) return ua.localeCompare(ub);
      const la = a.span?.start.line ?? 0, lb = b.span?.start.line ?? 0;
      if (la !== lb) return la - lb;
      const ca = a.span?.start.column ?? 0, cb = b.span?.start.column ?? 0;
      if (ca !== cb) return ca - cb;
      return a.code.localeCompare(b.code);
    });
}

export function normalize(input: { document: TodlDocument; diagnostics: readonly Diagnostic[] }): Golden {
  return { diagnostics: canonicalDiagnostics(input.diagnostics), document: canonicalDoc(input.document) };
}

// The prelude is seeded into every compiled model. We exclude its nodes from
// goldens so a snapshot captures only what the example authored. `check([])`
// yields a prelude-only model; the prelude is memoized, so its ids are stable
// within a process (and canonicalized away across processes). Cached once.
let preludeIdsCache: Set<string> | undefined;
function preludeIds(): Set<string> {
  if (preludeIdsCache === undefined) {
    preludeIdsCache = new Set(toJSON(check([]).model).nodes.map((n) => n.id));
  }
  return preludeIdsCache;
}

/** Emit the document of nodes the source authored: all nodes minus the implicit
 *  prelude and any explicit bases. Captures concepts, fields, taxonomies, terms,
 *  models, and instances — not just instance-tier nodes. Shared by golden
 *  verification and the playground's display compile. */
export function selectOwnDocument(model: Repository, baseDocs: readonly TodlDocument[] = []): TodlDocument {
  const excluded = new Set<string>(preludeIds());
  for (const b of baseDocs) for (const n of b.nodes) excluded.add(n.id);
  const ownIds = new Set(model.allNodes().map((n) => n.id).filter((id) => !excluded.has(id)));
  return toJSONOwn(model, ownIds);
}

function compile(entry: CorpusEntry): Golden {
  const { bases, sources } = toSourceFiles(entry);
  const idGen = new DeterministicIdGenerator();
  const baseDocs = bases.length > 0 ? basesToDocuments(bases) : [];
  const { model, diagnostics } =
    baseDocs.length > 0 ? checkAgainst(baseDocs, sources, idGen) : check(sources, idGen);
  return normalize({ document: selectOwnDocument(model, baseDocs), diagnostics });
}

// Bases arrive as raw source here (authoring style); compile them standalone to
// TodlDocuments so checkAgainst can seed the graph. Base ids are canonicalized
// away in normalize, so their non-determinism does not leak into goldens.
function basesToDocuments(bases: SourceFile[]): TodlDocument[] {
  return bases.map((b) => {
    const { model } = check([b], new DeterministicIdGenerator());
    return toJSON(model);
  });
}

function diffGolden(a: Golden, b: Golden): string | undefined {
  const sa = JSON.stringify(a, null, 2), sb = JSON.stringify(b, null, 2);
  if (sa === sb) return undefined;
  return `--- expected (golden)\n+++ actual\n${sa}\n=====\n${sb}`;
}

export function verifyExample(entry: CorpusEntry, opts: { update?: boolean } = {}): VerifyResult {
  const actual = compile(entry);
  if (opts.update) return { id: entry.manifest.id, status: "updated", golden: actual };
  const diff = diffGolden(entry.golden, actual);
  return diff ? { id: entry.manifest.id, status: "fail", diff } : { id: entry.manifest.id, status: "pass" };
}

export function verifyAll(entries: readonly CorpusEntry[], opts: { update?: boolean } = {}): VerifySummary {
  const results = entries.map((e) => verifyExample(e, opts));
  return {
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    updated: results.filter((r) => r.status === "updated").length,
    results,
  };
}
