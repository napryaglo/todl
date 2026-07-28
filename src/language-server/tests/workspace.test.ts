import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectRegistry } from "../workspace.js";

test("assigns a document to its project by longest-prefix match", () => {
  const reg = new ProjectRegistry();
  reg.register("todl://p1/");
  reg.register("todl://p1/nested/");   // longer prefix wins
  assert.equal(reg.projectFor("todl://p1/a.todl")?.rootUri, "todl://p1/");
  assert.equal(reg.projectFor("todl://p1/nested/b.todl")?.rootUri, "todl://p1/nested/");
  assert.equal(reg.projectFor("todl://other/x.todl"), null);
});

test("setBases registers the root and stores bases; markDirty flags it", () => {
  const reg = new ProjectRegistry();
  reg.setBases("todl://p/", []);
  const p = reg.projectFor("todl://p/x.todl")!;
  assert.deepEqual(p.bases, []);
  assert.equal(p.dirty, true);   // setBases marks dirty
  p.dirty = false;
  reg.markDirty("todl://p/");
  assert.equal(reg.dirtyProjects().length, 1);
});
