import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Repository } from "../../model/model.js";
import { Cardinality } from "../../model/graph.js";
import { toJSON } from "../../emit/json.js";
import { generateReadClient } from "../read-client.js";
import { TechCatalog } from "./fixtures/tech-catalog.generated.js";

// billing/location/technology concepts + a `stack` taxonomy + instances.
function catalogRepo(): Repository {
  const r = new Repository();
  const b = r.builder();
  b.definePrimitive("string");
  b.defineConcept("billing");
  b.addField("billing", "label", "string");
  b.defineConcept("location");
  b.addField("location", "label", "string");
  b.defineConcept("technology");
  b.addField("technology", "label", "string");
  b.addField("technology", "billing", "billing", Cardinality.Optional);
  b.addField("technology", "available-in", "location", Cardinality.Many);
  b.defineTaxonomy("stack", ["technology"], [{ id: "m365", attrs: new Map([["label", "M365"]]) }]);
  b.assertInstance("billing", "subscription");
  b.setField("subscription", "label", "Subscription");
  b.assertInstance("location", "westeurope");
  b.setField("westeurope", "label", "West Europe");
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.addRelationship("copilot", "billing", "subscription");
  b.addRelationship("copilot", "available-in", "westeurope");
  b.commit();
  return r;
}

test("generateReadClient reproduces the golden fixture byte-for-byte", () => {
  const golden = readFileSync(
    fileURLToPath(new URL("./fixtures/tech-catalog.generated.ts", import.meta.url)),
    "utf8",
  );
  const out = generateReadClient(catalogRepo(), { name: "tech-catalog", importSpecifier: "../../../index.js" });
  assert.equal(out, golden);
});

test("the generated client compiles and runs with typed navigation", () => {
  const catalog = TechCatalog.fromJSON(toJSON(catalogRepo()));
  assert.deepEqual(catalog.technologies.map((t) => t.label), ["Copilot"]);
  const copilot = catalog.technologies[0]!;
  assert.equal(copilot.billing!.label, "Subscription");
  assert.deepEqual(copilot.availableIn.map((l) => l.label), ["West Europe"]);
  assert.deepEqual(catalog.stack.map((t) => t.label), ["M365"]);
  // reference resolves to the shared identity-map handle
  assert.equal(copilot.availableIn[0], catalog.locations[0]);
});
