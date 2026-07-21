import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../../parse/loader.js";

function repo(text: string) {
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).model;
}

test("isClass / classOf / instancesOfClass over instanceof", () => {
  const m = repo(
    `concept component {} class component teams-chat {} component a instanceof teams-chat {} component b instanceof teams-chat {}`,
  );
  assert.equal(m.isClass("teams-chat"), true);
  assert.equal(m.isClass("a"), false);
  assert.equal(m.classOf("a"), "teams-chat");
  assert.equal(m.classOf("teams-chat"), null);
  assert.deepEqual(m.instancesOfClass("teams-chat").sort(), ["a", "b"]);
});

test("represents / representedBy / termsOf over a taxonomy", () => {
  const m = repo(
    `concept category { icon : string; } taxonomy component-category : represents category { term conversational-interface { icon = "chat.svg"; } term web-portal {} }`,
  );
  assert.deepEqual(m.represents("component-category"), ["category"]);
  assert.deepEqual(m.representedBy("category"), ["component-category"]);
  assert.deepEqual(m.termsOf("component-category").sort(), [
    "component-category.conversational-interface",
    "component-category.web-portal",
  ]);
});

test("effectiveFields merges class-fixed values with leaf fills", () => {
  const m = repo(
    `concept component { realised-by : string; region : string; } class component teams-chat { realised-by = "teams"; } component hq instanceof teams-chat { region = "eu"; }`,
  );
  const eff = m.effectiveFields("hq");
  assert.equal(eff.get("realised-by"), "teams"); // inherited, fixed
  assert.equal(eff.get("region"), "eu"); // leaf fill
  assert.equal(eff.get("class"), undefined); // marker not leaked
});
