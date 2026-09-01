import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDocs } from "../docs-markdown.js";
import { CORPUS } from "../../examples/corpus.generated.js";

test("emits an index plus one file per example", () => {
  const files = renderDocs(CORPUS);
  assert.ok(files.some((f) => f.path === "index.md"));
  assert.equal(files.filter((f) => f.path !== "index.md").length, CORPUS.length);
});

test("index links to every example file", () => {
  const files = renderDocs(CORPUS);
  const index = files.find((f) => f.path === "index.md")!;
  for (const f of files) {
    if (f.path === "index.md") continue;
    assert.ok(index.content.includes(f.path), `index should link ${f.path}`);
  }
});

test("an example doc carries title, narrative, a fenced todl source, and node/edge counts", () => {
  const files = renderDocs(CORPUS);
  const first = CORPUS[0];
  const doc = files.find((f) => f.path.endsWith(`${first.manifest.id}.md`))!;
  assert.ok(doc.content.includes(first.manifest.title));
  assert.ok(doc.content.includes("```todl"));
  assert.ok(doc.content.includes(first.sources[0].text.trim().split("\n")[0]));
  assert.match(doc.content, /node\(s\)|edge\(s\)/);
});

test("an intentional-error example renders its diagnostics", () => {
  const files = renderDocs(CORPUS);
  const errored = CORPUS.find((e) => e.golden.diagnostics.some((d) => d.severity === "error"));
  if (!errored) return; // corpus always has one, but stay defensive
  const doc = files.find((f) => f.path.endsWith(`${errored.manifest.id}.md`))!;
  assert.ok(doc.content.toLowerCase().includes("diagnostic"));
  assert.ok(doc.content.includes(errored.golden.diagnostics[0].code));
});

test("output is deterministic", () => {
  assert.deepEqual(renderDocs(CORPUS), renderDocs(CORPUS));
});
