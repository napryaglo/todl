import { test } from "node:test";
import assert from "node:assert/strict";
import { pascalCase, camelCase, pluralize, allocateNames } from "../naming.js";

test("pascalCase joins kebab segments and capitalizes each", () => {
  assert.equal(pascalCase("component"), "Component");
  assert.equal(pascalCase("app-component"), "AppComponent");
  assert.equal(pascalCase("microsoft-tech"), "MicrosoftTech");
});

test("camelCase lowercases the first segment, capitalizes the rest", () => {
  assert.equal(camelCase("label"), "label");
  assert.equal(camelCase("implemented-by"), "implementedBy");
  assert.equal(camelCase("available-in"), "availableIn");
});

test("pluralize applies the English heuristic", () => {
  assert.equal(pluralize("component"), "components");
  assert.equal(pluralize("technology"), "technologies");
  assert.equal(pluralize("category"), "categories");
  assert.equal(pluralize("location"), "locations");
  assert.equal(pluralize("box"), "boxes");
  assert.equal(pluralize("stack"), "stacks");
});

test("allocateNames maps each id and throws on a collision", () => {
  const map = allocateNames(["app-component", "technology"], pascalCase);
  assert.equal(map.get("technology"), "Technology");
  assert.throws(() => allocateNames(["chat-surface", "chat--surface"], pascalCase), /collision|both map/i);
});
