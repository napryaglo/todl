import { test } from "node:test";
import assert from "node:assert/strict";
import { load as loadFiles } from "../loader.js";
import { EdgeKind, Direction } from "../../model/graph.js";

function model(text: string) {
  return loadFiles([{ uri: "s.todl", text }]).model;
}

const SRC = `namespace d {
  concept technology { label : string; }
  concept component { label : string; implemented-by : technology?; }
  taxonomy techs : represents technology { term copilot { label = "Copilot"; } }
  taxonomy kinds : represents component {
    term chat { label = "Chat"; implemented-by = techs.copilot; }
  }
}`;

test("a term's concept-typed field is realized as an edge, not a string attr", () => {
  const m = model(SRC);
  assert.deepEqual(
    m.related("kinds.chat", EdgeKind.Relationship, Direction.Out, "implemented-by"),
    ["techs.copilot"],
  );
  assert.equal(m.resolve("kinds.chat")?.attrs.has("implemented-by"), false);
});

test("a term's primitive-typed field stays a scalar attr", () => {
  const m = model(SRC);
  assert.equal(m.resolve("kinds.chat")?.attrs.get("label"), "Chat");
});
