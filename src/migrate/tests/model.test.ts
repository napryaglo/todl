import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { listTodlSources, migrateFiles } from "../run.js";
import { rewrite } from "../rewriter.js";
import { load as loadFiles } from "../../parse/loader.js";
import { DiagnosticCode } from "../../validate/validate.js";

/** Test shim: wrap raw source strings as SourceFiles and return the model. */
function load(texts: string[]) {
  return loadFiles(texts.map((text, i) => ({ uri: `s${i}.todl`, text }))).model;
}

const ROOT = new URL("../../../../test_migration/", import.meta.url);
const META_DIR = fileURLToPath(new URL("legacy-source/meta-models/enterprise-architecture", ROOT));
const LIB_DIR = fileURLToPath(new URL("legacy-source/libraries", ROOT));
const MODEL_FILE = fileURLToPath(new URL("legacy-source/models/ai-enabled-composable-landscape.architecture.model", ROOT));

function loadEverything() {
  return load([
    ...migrateFiles(listTodlSources(META_DIR)),
    ...migrateFiles(listTodlSources(LIB_DIR)),
    rewrite(readFileSync(MODEL_FILE, "utf8")),
  ]);
}

test("the migrated model loads against meta + libraries", () => {
  const model = loadEverything();
  // A representative spread of record kinds from the model.
  assert.equal(model.resolve("ai-enabled-composable-landscape")?.typeOf, "model");
  assert.equal(model.resolve("m365-copilot-chat")?.typeOf, "component");
  assert.equal(model.resolve("enterprise-vnet")?.typeOf, "network");
});

test("library locations resolve the model's cross-library references", () => {
  const model = loadEverything();
  // These live in the microsoft / aws libraries, not the model.
  assert.equal(model.resolve("azure")?.typeOf, "location");
  assert.equal(model.resolve("m365")?.typeOf, "location");
  assert.equal(model.resolve("aws")?.typeOf, "location");
});

test("adding libraries clears the model's location target-type mismatches", () => {
  const model = loadEverything();
  const targetType = model
    .validate()
    .filter((d) => d.code === DiagnosticCode.TargetTypeMismatch);
  // Down from 23 (no libraries) to a small residue of genuinely-absent refs.
  assert.ok(targetType.length <= 5, `expected ≤5 target-type mismatches, got ${targetType.length}`);
});
