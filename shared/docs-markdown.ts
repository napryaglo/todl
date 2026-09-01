import type { CorpusEntry, Golden } from "./corpus-types.js";
import { byGroup } from "./corpus-access.js";

export interface DocFile { path: string; content: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const fileFor = (e: CorpusEntry) => `${slug(e.manifest.group)}/${e.manifest.id}.md`;

function outputSection(golden: Golden): string {
  const nodes = golden.document.nodes.length, edges = golden.document.edges.length;
  const lines = [`**Compiled:** ${nodes} node(s), ${edges} edge(s).`, ""];
  if (golden.diagnostics.length) {
    lines.push("### Diagnostics", "");
    for (const d of golden.diagnostics) lines.push(`- \`${d.severity}\` \`${d.code}\` — ${d.message}`);
    lines.push("");
  }
  lines.push("```json", JSON.stringify(golden.document, null, 2), "```", "");
  return lines.join("\n");
}

function exampleDoc(e: CorpusEntry): string {
  const parts = [`# ${e.manifest.title}`, "", e.manifest.narrative.trim(), ""];
  if (e.manifest.tags.length) parts.push(`*Tags: ${e.manifest.tags.join(", ")}*`, "");
  for (const s of e.sources) {
    if (e.sources.length > 1) parts.push(`**\`${s.name}\`**`, "");
    parts.push("```todl", s.text.trim(), "```", "");
  }
  parts.push(outputSection(e.golden));
  parts.push("---", "", "[← back to index](../index.md)", "");
  return parts.join("\n");
}

function indexDoc(corpus: readonly CorpusEntry[]): string {
  const parts = ["# TODL examples", "", "Generated from the example corpus — every snippet below is a verified golden-snapshot test.", ""];
  for (const [group, entries] of byGroup(corpus)) {
    parts.push(`## ${group}`, "");
    for (const e of entries) parts.push(`- [${e.manifest.title}](${fileFor(e)}) — ${e.manifest.narrative.trim().split("\n")[0]}`);
    parts.push("");
  }
  return parts.join("\n");
}

/** Corpus → static markdown files (index + one per example). Pure: caller writes them. */
export function renderDocs(corpus: readonly CorpusEntry[]): DocFile[] {
  const files: DocFile[] = [{ path: "index.md", content: indexDoc(corpus) }];
  for (const [, entries] of byGroup(corpus)) {
    for (const e of entries) files.push({ path: fileFor(e), content: exampleDoc(e) });
  }
  return files;
}
