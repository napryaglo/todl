import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, ValueKind, type ConceptDecl, type InstanceDecl } from "../ast.js";

test("concept extends + field + relationship carry reference spans", () => {
  const src = [
    "namespace demo {",
    "  concept animal { }",
    "  concept dog : animal {",
    "    name : string;",
    "    relationship owner -> person [];",
    "  }",
    "}",
  ].join("\n");
  const { namespace } = parse(src, "d.todl");
  const dog = namespace.declarations.find(
    (d): d is ConceptDecl => d.kind === DeclKind.Concept && d.name === "dog",
  )!;
  // `animal` in `: animal` is on line 3 (1-based), columns 17..23 (exclusive end).
  assert.deepEqual(dog.extendsSpan?.start, { line: 3, column: 17 });
  assert.equal(dog.extendsSpan?.end.column, 23);
  assert.deepEqual(dog.fields[0]!.nameSpan?.start, { line: 4, column: 5 });
  assert.deepEqual(dog.fields[0]!.typeSpan?.start, { line: 4, column: 12 });
  assert.deepEqual(dog.relationships[0]!.nameSpan?.start, { line: 5, column: 18 });
  assert.deepEqual(dog.relationships[0]!.targetSpan?.start, { line: 5, column: 27 });
});

test("imports and instance concept/instanceof and ref values carry spans", () => {
  const src = [
    "namespace demo {",
    "  import other.lib;",
    "  concept person { }",
    "  person alice instanceof someone { friend = &bob; }",
    "}",
  ].join("\n");
  const { namespace } = parse(src, "d.todl");
  assert.equal(namespace.importSpans?.length, 1);
  assert.deepEqual(namespace.importSpans?.[0]?.start, { line: 2, column: 10 });
  const alice = namespace.declarations.find(
    (d): d is InstanceDecl => d.kind === DeclKind.Instance && d.id === "alice",
  )!;
  assert.deepEqual(alice.conceptSpan?.start, { line: 4, column: 3 });
  assert.deepEqual(alice.instanceOfSpan?.start, { line: 4, column: 27 });
  const ref = alice.assignments[0]!.value;
  assert.equal(ref.kind, ValueKind.Ref);
  assert.deepEqual((ref as { span?: { start: unknown } }).span?.start, { line: 4, column: 46 });
});
