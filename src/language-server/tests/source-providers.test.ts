import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { PushedSourceProvider, FsSourceProvider, ProjectRegistry } from "../workspace.js";

// A TextDocuments stub exposing just `all()` (the only method providers use).
function docsWith(...docs: TextDocument[]): TextDocuments<TextDocument> {
  return { all: () => docs } as unknown as TextDocuments<TextDocument>;
}

test("pushed provider returns the open documents under the project root", () => {
  const reg = new ProjectRegistry();
  const p = reg.register("todl://p/");
  const docs = docsWith(
    TextDocument.create("todl://p/a.todl", "todl", 1, "namespace demo { }"),
    TextDocument.create("todl://other/b.todl", "todl", 1, "namespace x { }"),
  );
  const sources = new PushedSourceProvider().sourcesFor(p, docs);
  assert.deepEqual(sources.map((s) => s.uri), ["todl://p/a.todl"]);
});

test("fs provider scans *.todl on disk under the root", () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-fs-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "a.todl"), "namespace a { }");
  writeFileSync(join(dir, "sub", "b.todl"), "namespace b { }");
  writeFileSync(join(dir, "note.txt"), "ignore me");
  const rootUri = pathToFileURL(dir).href.replace(/\/?$/, "/");
  const reg = new ProjectRegistry();
  const p = reg.register(rootUri);
  const sources = new FsSourceProvider().sourcesFor(p, docsWith());
  assert.deepEqual(sources.map((s) => s.uri.endsWith(".todl")).every(Boolean), true);
  assert.equal(sources.length, 2);
});
