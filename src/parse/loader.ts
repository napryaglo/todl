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
import { DeclKind, ValueKind, type Declaration, type InstanceDecl, type ValueNode } from "./ast.js";

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
  const counter: HoistCounter = { n: 0 };
  const asserted = new Set<string>();
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
      applyInstance(second, declaration, null, counter, asserted);
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
      // Enum-case nodes are enum-qualified (see Builder.defineEnum); record the
      // qualified id so a bare enum value used in an instance resolves to a
      // placeholder rather than falsely appearing already-defined.
      for (const enumCase of declaration.cases) defined.add(`${declaration.name}.${enumCase.id}`);
      break;
    case DeclKind.Concept:
      defined.add(declaration.name);
      if (declaration.extends !== null) referenced.add(declaration.extends);
      break;
    case DeclKind.Instance:
      collectInstanceNames(declaration, defined, referenced);
      break;
  }
}

function collectInstanceNames(decl: InstanceDecl, defined: Set<string>, referenced: Set<string>): void {
  defined.add(decl.id);
  for (const assignment of decl.assignments) collectValueRefs(assignment.value, referenced);
  for (const child of decl.children) collectInstanceNames(child, defined, referenced);
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
    case ValueKind.Object:
      for (const field of value.fields) collectValueRefs(field.value, referenced);
      break;
    case ValueKind.String:
    case ValueKind.Composite:
      break;
  }
}

/** A mutable counter used to synthesize ids for hoisted inline-object records. */
interface HoistCounter {
  n: number;
}

function applyInstance(
  builder: Builder,
  decl: InstanceDecl,
  parent: string | null,
  counter: HoistCounter,
  asserted: Set<string>,
): void {
  // Legacy authoring may declare the same record id in more than one place
  // (e.g. a component under two location blocks); merge later fields onto the
  // first assertion rather than erroring on the duplicate node.
  const first = !asserted.has(decl.id);
  if (first) {
    asserted.add(decl.id);
    builder.assertInstance(decl.concept, decl.id);
    // The record name is its `id`; surface it as the field the schema declares.
    builder.setField(decl.id, "id", decl.id);
    if (decl.binds !== null) builder.setField(decl.id, "meta-model", decl.binds);
    if (parent !== null) builder.addContains(parent, decl.id);
  }
  for (const assignment of decl.assignments) {
    applyValue(builder, decl.id, assignment.name, assignment.value, counter);
  }
  for (const child of decl.children) {
    applyInstance(builder, child, decl.id, counter, asserted);
  }
}

function applyValue(builder: Builder, id: string, name: string, value: ValueNode, counter: HoistCounter): void {
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
      for (const item of value.items) applyValue(builder, id, name, item, counter);
      break;
    case ValueKind.Composite:
      // `|`-composed enum flags are stored as the legacy scalar string
      // (`"cloud | paas"`); the runtime enum table's has() splits on `|`.
      builder.setField(id, name, value.parts.join(" | "));
      break;
    case ValueKind.Object: {
      // Inline objects become standalone records typed by the (singularized)
      // field name, linked to the parent by a field-named relationship.
      const childId = `${id}.${name}#${(counter.n += 1)}`;
      builder.assertInstance(singularize(name), childId);
      builder.addRelationship(id, name, childId);
      for (const field of value.fields) {
        applyValue(builder, childId, field.name, field.value, counter);
      }
      break;
    }
  }
}

/** Naive singularizer for hoisted-object concept names (`peers` → `peer`). */
function singularize(name: string): string {
  return name.endsWith("s") ? name.slice(0, -1) : name;
}
