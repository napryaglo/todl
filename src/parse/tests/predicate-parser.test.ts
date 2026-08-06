import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { tokenize, TokenKind } from "../lexer.js";
import { parsePredicate } from "../predicate-parser.js";
import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";
import { Repository } from "../../model/model.js";
import { satisfies } from "../../predicate/evaluate.js";

function predicate(source: string) {
  const tokens = tokenize(source).filter((token) => token.kind !== TokenKind.EOF);
  return parsePredicate(tokens);
}

function serviceTask(assignee: string | null): Repository {
  const model = new Repository();
  const builder = model.builder();
  builder.assertInstance("TaskType", "service");
  builder.assertInstance("task", "t1").addRelationship("t1", "type", "service");
  if (assignee !== null) builder.setField("t1", "assignee", assignee);
  builder.commit();
  return model;
}

test("assignee invariant holds for a service task with no assignee", () => {
  const expr = predicate("(this.type == service || this.type == script) implies this.assignee == none");
  assert.equal(satisfies(serviceTask(null), expr, "t1"), true);
});

test("assignee invariant fails for a service task that has an assignee", () => {
  const expr = predicate("(this.type == service || this.type == script) implies this.assignee == none");
  assert.equal(satisfies(serviceTask("sales-manager"), expr, "t1"), false);
});

test("start-event invariant desugars .empty and holds with no incoming flows", () => {
  const expr = predicate("this.event-type == start implies this.incoming.empty");
  const model = new Repository();
  model
    .builder()
    .assertInstance("EventType", "start")
    .assertInstance("event", "e1")
    .addRelationship("e1", "EventType", "start")
    .commit();

  assert.equal(satisfies(model, expr, "e1"), true);
});

test("start-event invariant fails when a start event has an incoming flow", () => {
  const expr = predicate("this.event-type == start implies this.incoming.empty");
  const model = new Repository();
  model
    .builder()
    .assertInstance("EventType", "start")
    .assertInstance("SequenceFlow", "f1")
    .assertInstance("event", "e1")
    .addRelationship("e1", "EventType", "start")
    .addRelationship("e1", "incoming", "f1")
    .commit();

  assert.equal(satisfies(model, expr, "e1"), false);
});

test("parses the predicate captured from the concept fixture and evaluates it", () => {
  const { namespace } = parse(
    readFileSync(fileURLToPath(new URL("./fixtures/concepts.todl", import.meta.url)), "utf8"),
  );
  const task = namespace.declarations.find(
    (declaration) => declaration.kind === DeclKind.Concept && declaration.name === "task",
  );
  assert.ok(task && task.kind === DeclKind.Concept);

  const captured = task.kind === DeclKind.Concept ? task.invariants[1]?.predicate : null;
  assert.ok(captured);

  const expr = parsePredicate(captured);
  assert.equal(satisfies(serviceTask(null), expr, "t1"), true);
  assert.equal(satisfies(serviceTask("bob"), expr, "t1"), false);
});
