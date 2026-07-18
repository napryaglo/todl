import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

test("a concept declaration carries a source span", () => {
  const ns = parse(fixture("concepts.todl"), "concepts.todl");
  const concept = ns.declarations.find((d) => d.kind === DeclKind.Concept);
  assert.ok(concept);
  assert.equal(concept!.span.uri, "concepts.todl");
  assert.ok(concept!.span.start.line >= 1);
  assert.ok(concept!.span.end.line >= concept!.span.start.line);
});

test("an instance assignment carries its own span", () => {
  const ns = parse(fixture("order-fulfillment.todl"), "order-fulfillment.todl");
  const instance = ns.declarations.find((d) => d.kind === DeclKind.Instance);
  assert.ok(instance && instance.kind === DeclKind.Instance);
  const assignment = instance.assignments[0];
  assert.ok(assignment?.span);
  assert.equal(assignment!.span.uri, "order-fulfillment.todl");
});
