import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { listTodlSources, migrateFiles } from "../run.js";
import { load } from "../../parse/loader.js";
import { MetaKind } from "../../model/kinds.js";

/** The legacy EA meta-model snapshot at the repo root (Phase 0). */
const EA_META_DIR = fileURLToPath(
  new URL("../../../../test_migration/legacy-source/meta-models/enterprise-architecture", import.meta.url),
);

/**
 * Faithfulness gate (§9): the rewritten EA meta-model must load with the full
 * concept + enum count and produce zero validation diagnostics. Running the
 * legacy Python compiler is out of band, so "same graph as the original" is
 * approximated here by a clean, complete load; the rewritten tree is reviewed
 * before it is treated as canonical.
 */
test("rewritten EA meta-model loads complete and validates clean", () => {
  const model = load(migrateFiles(listTodlSources(EA_META_DIR)));

  assert.equal(model.instancesOf(MetaKind.Concept).length, 23, "23 concepts");
  assert.equal(model.instancesOf(MetaKind.Enum).length, 17, "17 enums");

  for (const concept of ["component", "connector", "technology", "scenario", "location", "model"]) {
    assert.equal(model.resolve(concept)?.typeOf, MetaKind.Concept, `${concept} resolves as a concept`);
  }

  assert.deepEqual(model.validate(), [], "no validation diagnostics");
});
