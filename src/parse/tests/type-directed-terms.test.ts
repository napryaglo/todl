import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { EdgeKind, Direction } from "../../model/graph.js";

function model(text: string) {
  return loadFiles([{ uri: "s.todl", text }]).model;
}

const SRC = `namespace d {
  concept Technology { label : string; }
  concept Component { label : string; implementedBy : Technology?; }
  taxonomy Techs : represents Technology { term Copilot { label = "Copilot"; } }
  taxonomy Kinds : represents Component {
    term Chat { label = "Chat"; implementedBy = Techs.Copilot; }
  }
}`;

test("a term's concept-typed field is realized as an edge, not a string attr", () => {
  const m = model(SRC);
  assert.deepEqual(
    m.related("Kinds.Chat", EdgeKind.Relationship, Direction.Out, "implementedBy"),
    ["Techs.Copilot"],
  );
  assert.equal(m.resolve("Kinds.Chat")?.attrs.has("implementedBy"), false);
});

test("a term's primitive-typed field stays a scalar attr", () => {
  const m = model(SRC);
  assert.equal(m.resolve("Kinds.Chat")?.attrs.get("label"), "Chat");
});
