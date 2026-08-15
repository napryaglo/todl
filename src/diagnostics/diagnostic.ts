import type { NodeId } from "../model/graph.js";
import type { SourceSpan } from "./span.js";

export enum Severity {
  Error = "error",
  Warning = "warning",
}

export enum DiagnosticCode {
  // Lex / parse (syntax) phase.
  UnexpectedCharacter = "syntax.unexpected-character",
  UnterminatedString = "syntax.unterminated-string",
  UnexpectedToken = "syntax.unexpected-token",
  ExpectedToken = "syntax.Expected",
  // Semantic phase (unchanged values).
  RequiredMissing = "cardinality.required-missing",
  TooMany = "cardinality.too-many",
  EmptyNotAllowed = "cardinality.empty-not-allowed",
  TargetTypeMismatch = "relationship.target-type",
  BooleanValueInvalid = "type.boolean-invalid",
  InvariantFailed = "invariant.failed",
  // Class + taxonomy phase.
  ClassOverride = "Class.override",
  BindingInvalid = "Class.binding-invalid",
  TaxonomyNoRepresentedConcept = "taxonomy.no-represented-concept",
  TaxonomyValueUnresolved = "taxonomy.value-unresolved",
  TermConceptNotRepresented = "taxonomy.term-concept-not-represented",
  TaxonomyTermConceptAmbiguous = "taxonomy.term-concept-ambiguous",
  ViewpointNoFramedConcept = "viewpoint.no-framed-concept",
  ViewpointFramesNotConcept = "viewpoint.frames-not-concept",
  // Instance-loading phase.
  AmbiguousFieldBinding = "Instance.ambiguous-field-binding",
  // A member's value shape does not match its declared type (e.g. a reference
  // member given a quoted string, or a value member given a list).
  MemberValueKind = "member.value-kind",
  // An inline object assigned to a non-concept-typed member.
  InlineObjectTarget = "inline-object.target",
  // An inline object whose concept is not the field's type or a subtype.
  InlineObjectType = "inline-object.type",
  // Reference-resolution phase.
  ReferenceUndefined = "reference.undefined",
  // A symbol exists but lives in a namespace this reference's home namespace
  // does not import (and is not the reference's own namespace). Distinct from
  // reference.undefined so "you forgot an import" reads differently from "no
  // such symbol" — the migration to namespace-scoped resolution is mechanical.
  ReferenceUnreachable = "reference.unreachable",
  // Taxonomy bare-reference resolution.
  TaxonomyAmbiguousBareReference = "taxonomy.ambiguous-bare-reference",
  TaxonomyUsesUndefined = "taxonomy.uses-undefined",
  // Model phase.
  InstanceOrphan = "instance.orphan",
  ModelBindingUndefined = "model.binding-undefined",
  ModelConformsNotViewpoint = "model.conforms-not-viewpoint",
  ModelEntityNotFramed = "model.entity-not-framed",
  ModelConformsRequiredWhenSplit = "model.conforms-required-when-split",
  ConstructorOutOfScope = "constructor.out-of-scope",
  // Prelude (default library) phase.
  PreludeNameRedeclared = "prelude.name-redeclared",
  // Annotation phase.
  AnnotationDuplicate = "annotation.duplicate",
  AnnotationUnknownParam = "annotation.unknown-param",
  AnnotationInvalidTarget = "annotation.invalid-target",
  AnnotationBaseNotAnnotation = "annotation.base-not-annotation",
  AnnotationParamRedeclared = "annotation.param-redeclared",
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  /** Source location; `null` only for genuine whole-model diagnostics. */
  span: SourceSpan | null;
  /** Semantic phase: the offending node; `null` for syntax diagnostics. */
  node: NodeId | null;
  /** Semantic phase: concept-qualified member path (`component.label`); else `null`. */
  path: string | null;
}
