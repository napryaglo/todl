import { test } from "node:test";
import assert from "node:assert/strict";
import { pascalCase, camelCase, pluralize, allocateNames } from "../naming.js";

test("pascalCase splits kebab/underscore/case boundaries and capitalizes each", () => {
  assert.equal(pascalCase("component"), "Component");
  assert.equal(pascalCase("app-component"), "AppComponent");
  assert.equal(pascalCase("MicrosoftTech"), "MicrosoftTech");
  assert.equal(pascalCase("AppComponent"), "AppComponent"); // idempotent
  assert.equal(pascalCase("appComponent"), "AppComponent");
});

test("camelCase lowercases the first word, capitalizes the rest", () => {
  assert.equal(camelCase("label"), "label");
  assert.equal(camelCase("implementedBy"), "implementedBy");
  assert.equal(camelCase("availableIn"), "availableIn");
  assert.equal(camelCase("ImplementedBy"), "implementedBy"); // idempotent
  assert.equal(camelCase("implementedBy"), "implementedBy");
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
  const map = allocateNames(["AppComponent", "Technology"], pascalCase);
  assert.equal(map.get("Technology"), "Technology");
  assert.throws(() => allocateNames(["chatSurface", "chat-surface"], pascalCase), /collision|both map/i);
});
