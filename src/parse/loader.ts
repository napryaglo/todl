/**
 * Loader (design spec §5) — parse TODL sources and build a {@link Model}.
 *
 * Two passes over the combined declarations: pass one defines the bare type
 * declarations (primitives, enums + case nodes, concepts + extends) and creates
 * placeholder nodes for any *referenced-but-undefined* id (the fixtures
 * deliberately reference `lane` / `event-trigger` / … without defining them);
 * pass two adds concept members and instances. Executable invariants register
 * after loading. Field types / relationship targets are attrs, so they need no
 * node — only extends parents and instance value refs become edges.
 */

import { parse } from "./parser.js";
import { parsePredicate } from "./predicate-parser.js";
import { Model } from "../model/model.js";
import type { Builder, EnumCaseInput } from "../model/builder.js";
import type { Expr } from "../predicate/ast.js";
import { DeclKind, ValueKind, type Declaration, type ValueNode } from "./ast.js";

const UNRESOLVED = "unresolved";

interface PendingInvariant {
  concept: string;
  expr: Expr;
  description: string;
}

export function load(sources: string[]): Model {
  const declarations = sources.flatMap((source) => parse(source).declarations);
  const model = new Model();

  const defined = new Set<string>();
  const referenced = new Set<string>();
  for (const declaration of declarations) collectNames(declaration, defined, referenced);

  // Pass 1: bare type declarations + placeholders for unresolved references.
  const first = model.builder();
  for (const declaration of declarations) {
    switch (declaration.kind) {
      case DeclKind.Primitive:
        first.definePrimitive(declaration.name);
        break;
      case DeclKind.Enum:
        first.defineEnum(
          declaration.name,
          declaration.cases.map((enumCase) => {
            const input: EnumCaseInput = { id: enumCase.id };
            if (enumCase.label) input.label = enumCase.label;
            if (enumCase.description) input.description = enumCase.description;
            return input;
          }),
        );
        break;
      case DeclKind.Concept:
        first.defineConcept(declaration.name, declaration.extends);
        break;
      case DeclKind.Instance:
        break;
    }
  }
  for (const id of referenced) {
    if (!defined.has(id)) first.assertInstance(UNRESOLVED, id);
  }
  first.commit();

  // Pass 2: concept members + instances.
  const second = model.builder();
  const invariants: PendingInvariant[] = [];
  for (const declaration of declarations) {
    if (declaration.kind === DeclKind.Concept) {
      for (const field of declaration.fields) {
        second.addField(declaration.name, field.name, field.type, field.cardinality);
      }
      for (const relationship of declaration.relationships) {
        second.addConceptRelationship(declaration.name, relationship.name, relationship.target, relationship.cardinality);
      }
      for (const invariant of declaration.invariants) {
        if (invariant.predicate !== null) {
          invariants.push({
            concept: declaration.name,
            expr: parsePredicate(invariant.predicate),
            description: invariant.description,
          });
        }
      }
    } else if (declaration.kind === DeclKind.Instance) {
      second.assertInstance(declaration.concept, declaration.id);
      for (const assignment of declaration.assignments) {
        applyValue(second, declaration.id, assignment.name, assignment.value);
      }
    }
  }
  second.commit();

  for (const invariant of invariants) {
    model.defineInvariant(invariant.concept, invariant.expr, invariant.description);
  }
  return model;
}

function collectNames(declaration: Declaration, defined: Set<string>, referenced: Set<string>): void {
  switch (declaration.kind) {
    case DeclKind.Primitive:
      defined.add(declaration.name);
      break;
    case DeclKind.Enum:
      defined.add(declaration.name);
      for (const enumCase of declaration.cases) defined.add(enumCase.id);
      break;
    case DeclKind.Concept:
      defined.add(declaration.name);
      if (declaration.extends !== null) referenced.add(declaration.extends);
      break;
    case DeclKind.Instance:
      defined.add(declaration.id);
      for (const assignment of declaration.assignments) collectValueRefs(assignment.value, referenced);
      break;
  }
}

function collectValueRefs(value: ValueNode, referenced: Set<string>): void {
  switch (value.kind) {
    case ValueKind.Ref:
      referenced.add(value.ref);
      break;
    case ValueKind.Name:
      referenced.add(value.name);
      break;
    case ValueKind.List:
      for (const item of value.items) collectValueRefs(item, referenced);
      break;
    case ValueKind.String:
      break;
  }
}

function applyValue(builder: Builder, id: string, name: string, value: ValueNode): void {
  switch (value.kind) {
    case ValueKind.String:
      builder.setField(id, name, value.text);
      break;
    case ValueKind.Name:
      builder.addRelationship(id, name, value.name);
      break;
    case ValueKind.Ref:
      builder.addRelationship(id, name, value.ref);
      break;
    case ValueKind.List:
      for (const item of value.items) applyValue(builder, id, name, item);
      break;
  }
}
