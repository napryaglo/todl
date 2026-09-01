import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../main.js";

// Capture stdout for assertions.
function capture(fn: () => number): { code: number; out: string } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (s: string) => { chunks.push(s); return true; };
  try { const code = fn(); return { code, out: chunks.join("") }; }
  finally { (process.stdout as any).write = orig; }
}

test("list prints every example id", () => {
  const { code, out } = capture(() => runCommand(["list"]));
  assert.equal(code, 0);
  assert.match(out, /taxonomy-bare|prelude-element/);
});

test("run <id> prints diagnostics + emitted-json stages", () => {
  const { code, out } = capture(() => runCommand(["run", "missing-required"]));
  assert.equal(code, 0);
  assert.match(out, /diagnostics/i);
});

test("run with unknown id exits non-zero", () => {
  const { code } = capture(() => runCommand(["run", "nope"]));
  assert.equal(code, 1);
});

test("test (no --update) passes against committed goldens", () => {
  const { code, out } = capture(() => runCommand(["test"]));
  assert.equal(code, 0);
  assert.match(out, /pass/i);
});

test("docs --out writes an index and example files", () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-docs-"));
  const { code } = capture(() => runCommand(["docs", "--out", dir]));
  assert.equal(code, 0);
  assert.ok(existsSync(join(dir, "index.md")));
  assert.match(readFileSync(join(dir, "index.md"), "utf8"), /TODL examples/);
});
