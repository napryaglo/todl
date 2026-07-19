import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { check } from "../../api.js";
import { MetaKind } from "../../model/kinds.js";

// The migrated new-surface project (now taxonomy-based) lives outside this repo.
const ROOT = fileURLToPath(new URL("../../../../test_migration/test_project", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (f.endsWith(".todl")) out.push(f);
  }
  return out.sort();
}

function loadProject() {
  const files = walk(ROOT);
  const sources = files.map((f) => ({
    uri: relative(ROOT, f).split("\\").join("/"),
    text: readFileSync(f, "utf8"),
  }));
  return check(sources);
}

test("migrated test_project has the same 81 cardinality diagnostics as before", () => {
  const { diagnostics } = loadProject();
  assert.equal(diagnostics.length, 81);
  for (const d of diagnostics) {
    assert.match(d.code, /^cardinality\./, `unexpected non-cardinality code ${d.code}`);
  }
});

test("classification is now taxonomy-typed and resolves; the model still loads", () => {
  const { model } = loadProject();
  assert.equal(model.resolve("component-category")?.typeOf, MetaKind.Taxonomy);
  assert.equal(model.resolve("component-category.api-service")?.typeOf, "component-category");
  assert.equal(model.resolve("ai-enabled-composable-landscape")?.typeOf, "model");
  // cross-library locations still resolve
  assert.equal(model.resolve("azure")?.typeOf, "location");
});
