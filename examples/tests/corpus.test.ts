import { test } from "node:test";
import assert from "node:assert/strict";
import { CORPUS } from "../corpus.generated.js";
import { verifyAll } from "../../shared/verify.js";

test("every corpus example matches its committed golden", () => {
  const summary = verifyAll(CORPUS);
  const failures = summary.results.filter((r) => r.status === "fail");
  assert.equal(failures.length, 0,
    "corpus drift:\n" + failures.map((f) => `- ${f.id}\n${f.diff}`).join("\n"));
});

test("expectClean matches golden diagnostics", () => {
  for (const e of CORPUS) {
    const hasErrors = e.golden.diagnostics.some((d) => d.severity === "error");
    assert.equal(!hasErrors, e.manifest.expectClean, `${e.manifest.id}: expectClean mismatch`);
  }
});

test("corpus is non-empty and ids are unique", () => {
  assert.ok(CORPUS.length >= 9);
  assert.equal(new Set(CORPUS.map((e) => e.manifest.id)).size, CORPUS.length);
});
