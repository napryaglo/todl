import type { CorpusEntry } from "./corpus-types.js";

export function byId(corpus: readonly CorpusEntry[], id: string): CorpusEntry | undefined {
  return corpus.find((e) => e.manifest.id === id);
}

export function groups(corpus: readonly CorpusEntry[]): string[] {
  return [...new Set(corpus.map((e) => e.manifest.group))].sort((a, b) => a.localeCompare(b));
}

export function byGroup(corpus: readonly CorpusEntry[]): Map<string, CorpusEntry[]> {
  const out = new Map<string, CorpusEntry[]>();
  for (const g of groups(corpus)) {
    out.set(g, corpus.filter((e) => e.manifest.group === g).sort((a, b) => a.manifest.order - b.manifest.order));
  }
  return out;
}
