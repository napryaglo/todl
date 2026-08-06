import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { FrozenRepository } from "../../model/frozen.js";
import { Cardinality } from "../../model/graph.js";
import { toJSON } from "../../emit/json.js";
import { ModelDraft } from "../model-draft.js";
import { TodlFileStore, type FileIO } from "../../index.js";

function baseClient(): FrozenRepository {
  const repo = new Repository();
  const b = repo.builder().setNamespace("Acme.ea");
  b.definePrimitive("string");
  b.defineConcept("technology");
  b.addField("technology", "label", "string");
  b.defineConcept("component");
  b.addField("component", "label", "string");
  b.addField("component", "implementedBy", "technology", Cardinality.Optional);
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.commit();
  return FrozenRepository.fromJSON(toJSON(repo));
}

class MemoryFileIO implements FileIO {
  content = "";
  async read(): Promise<string> {
    return this.content;
  }
  async write(content: string): Promise<void> {
    this.content = content;
  }
}

test("save writes .todl; load reparses the model", async () => {
  const base = baseClient();
  const draft = ModelDraft.on([base], { namespace: "Acme.app" });
  draft.add({
    concept: "component",
    id: "gw",
    scalars: new Map([["label", "Gateway"]]),
    refs: new Map([["implementedBy", ["copilot"]]]),
  });

  const io = new MemoryFileIO();
  const store = new TodlFileStore(io, [base], { namespace: "Acme.app" });
  await store.save(draft);
  assert.match(io.content, /model acme-app-model : acme\.ea/);

  const { model, diagnostics } = await store.load();
  assert.deepEqual(diagnostics, []);
  assert.equal(model.entity("gw")!.field("label"), "Gateway");
  assert.equal(model.entity("gw")!.ref("implementedBy")!.id, "copilot");
});
