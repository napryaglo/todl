import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { Cardinality } from "../../model/graph.js";
import { toJSON } from "../../emit/json.js";
import { ModelDraft } from "../../authoring/model-draft.js";
import { TechCatalog } from "./fixtures/tech-catalog.generated.js";

// A base with concept schemas + library instances to reference across the boundary.
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
  b.addField("technology", "availableIn", "location", Cardinality.Many);
  b.assertInstance("billing", "subscription");
  b.setField("subscription", "label", "Subscription");
  b.assertInstance("location", "westeurope");
  b.setField("westeurope", "label", "West Europe");
  b.commit();
  return r;
}

test("a typed authoring constructor produces a descriptor ModelDraft.add consumes", () => {
  const base = TechCatalog.fromJSON(toJSON(catalogRepo()));
  const draft = ModelDraft.on([base], { namespace: "app" });

  // Author a new technology referencing frozen base instances — fully typed.
  const descriptor = base.technology("copilot", {
    label: "Copilot",
    billing: base.billings[0]!,
    availableIn: [base.locations[0]!],
  });
  const copilot = draft.add(descriptor);

  assert.equal(copilot.field("label"), "Copilot");
  assert.equal(copilot.ref("billing")!.id, "subscription");
  assert.deepEqual(copilot.refs("availableIn").map((e) => e.id), ["westeurope"]);
});

test("the descriptor shape matches InstanceDescriptor (scalars + refs by id)", () => {
  const base = TechCatalog.fromJSON(toJSON(catalogRepo()));
  const d = base.technology("x", { label: "X", availableIn: [base.locations[0]!] });
  assert.equal(d.concept, "technology");
  assert.equal(d.id, "x");
  assert.equal(d.scalars!.get("label"), "X");
  assert.deepEqual(d.refs!.get("availableIn"), ["westeurope"]);
  assert.equal(d.refs!.has("billing"), false); // omitted optional stays absent
});
