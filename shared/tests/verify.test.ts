import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExample, normalize, verifyAll } from "../verify.js";
import type { CorpusEntry } from "../corpus-types.js";

// Build an entry whose golden we compute now, so a re-run must match it.
function entryFor(id: string, files: { name: string; text: string }[], manifest?: Partial<CorpusEntry["manifest"]>): CorpusEntry {
  const base: CorpusEntry = {
    manifest: { id, title: id, group: "Test", order: 0, tags: [], narrative: "", files: files.map(f => f.name), expectClean: true, ...manifest },
    sources: files,
    golden: { diagnostics: [], document: { nodes: [], edges: [] } },
    dir: `examples/test/${id}`,
  };
  // Seed the golden from a first run (update path), then verifying must pass.
  const updated = verifyExample(base, { update: true });
  return { ...base, golden: updated.golden! };
}

test("a clean example verifies as pass against its own generated golden", () => {
  const e = entryFor("clean", [
    { name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "x"; } }` },
  ]);
  const r = verifyExample(e);
  assert.equal(r.status, "pass", r.diff);
});

test("verification is deterministic across repeated runs (canonical ids)", () => {
  const files = [{ name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "x"; } }` }];
  const a = verifyExample(entryFor("d1", files), {});
  const b = verifyExample(entryFor("d2", files), {});
  assert.equal(a.status, "pass");
  assert.equal(b.status, "pass");
});

test("an example with an intentional error snapshots its diagnostics", () => {
  const e = entryFor("err", [
    // Missing required `label` → a cardinality diagnostic.
    { name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { } }` },
  ], { expectClean: false });
  assert.ok(e.golden.diagnostics.length >= 1, "golden should capture the error");
  assert.equal(verifyExample(e).status, "pass");
});

test("drift is detected: a changed source fails against a stale golden", () => {
  const e = entryFor("drift", [
    { name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "x"; } }` },
  ]);
  const tampered: CorpusEntry = { ...e, sources: [{ name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "y"; } }` }] };
  const r = verifyExample(tampered);
  assert.equal(r.status, "fail");
  assert.ok(typeof r.diff === "string" && r.diff.length > 0);
});

test("normalize emits only own nodes, never the prelude bulk", () => {
  const e = entryFor("own", [
    { name: "m.todl", text: `namespace app { concept Component { label : string; } Component c { label = "x"; } }` },
  ]);
  // Prelude has many nodes; own doc here is small (concept + instance).
  assert.ok(e.golden.document.nodes.length < 10);
});

test("verifyAll aggregates a summary", () => {
  const files = [{ name: "m.todl", text: `namespace app { concept C { label : string; } C c { label = "x"; } }` }];
  const s = verifyAll([entryFor("a", files), entryFor("b", files)]);
  assert.equal(s.failed, 0);
  assert.equal(s.passed, 2);
});

test("normalize is exported and canonicalizes ids deterministically", () => {
  const doc = { nodes: [{ id: "zzz", tier: "Instance", typeOf: "ccc", attrs: {} }], edges: [] };
  const g = normalize({ document: doc, diagnostics: [] });
  assert.equal(g.document.nodes[0]!.id, "#n0");
  assert.equal(g.document.nodes[0]!.typeOf, "#r0");
});
