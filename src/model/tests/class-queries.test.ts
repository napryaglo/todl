import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../../parse/loader.js";

function repo(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).model;
}

test("isClass / classOf / instancesOfClass over instanceof", () => {
  const m = repo(
    `concept Component {} Class component teamsChat {} Component a instanceof teamsChat {} Component b instanceof teamsChat {}`,
  );
  assert.equal(m.isClass("teamsChat"), true);
  assert.equal(m.isClass("a"), false);
  assert.equal(m.classOf("a"), "teamsChat");
  assert.equal(m.classOf("teamsChat"), null);
  assert.deepEqual(m.instancesOfClass("teamsChat").sort(), ["a", "b"]);
});

test("represents / representedBy / termsOf over a taxonomy", () => {
  const m = repo(
    `concept Category { icon : string; } taxonomy ComponentCategory : represents Category { term ConversationalInterface { icon = "chat.svg"; } term WebPortal {} }`,
  );
  assert.deepEqual(m.represents("ComponentCategory"), ["category"]);
  assert.deepEqual(m.representedBy("category"), ["ComponentCategory"]);
  assert.deepEqual(m.termsOf("ComponentCategory").sort(), [
    "ComponentCategory.ConversationalInterface",
    "ComponentCategory.WebPortal",
  ]);
});

test("effectiveFields merges class-fixed values with leaf fills", () => {
  const m = repo(
    `concept Component { realisedBy : string; region : string; } Class component teamsChat { realisedBy = "teams"; } Component hq instanceof teamsChat { region = "eu"; }`,
  );
  const eff = m.effectiveFields("hq");
  assert.equal(eff.get("realisedBy"), "teams"); // inherited, fixed
  assert.equal(eff.get("region"), "eu"); // leaf fill
  assert.equal(eff.get("class"), undefined); // marker not leaked
});
