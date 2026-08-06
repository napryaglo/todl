/** Public API for `@pragmatic-lab/todl`. */

export { Signal, type Disposable } from "./core/signal.js";

export {
  Graph,
  Tier,
  EdgeKind,
  Direction,
  Cardinality,
  GraphChangeKind,
  type NodeId,
  type Scalar,
  type Node,
  type Edge,
  type GraphChangeArgs,
} from "./model/graph.js";

export {
  ReactiveNode,
  PropertyChangeKind,
  CollectionChangeKind,
  type PropertyChangedArgs,
  type CollectionChangedArgs,
  type INotifyPropertyChanged,
  type INotifyCollectionChanged,
} from "./model/reactive.js";

export { Builder, type TermInput } from "./model/builder.js";
export { MetaKind } from "./model/kinds.js";

export {
  Repository,
  type FieldSchema,
  type RelationshipSchema,
  type ConceptSchema,
} from "./model/model.js";

export { EntityBase, type Entity } from "./model/entity.js";

export { FrozenRepository } from "./model/frozen.js";

export { generateReadClient, isReferenceType, type ReadClientOptions } from "./codegen/read-client.js";

export { ModelDraft, type InstanceDescriptor } from "./authoring/model-draft.js";

export {
  ExprKind,
  BinaryOp,
  UnaryOp,
  QuantifierKind,
  THIS,
  NONE,
  variable,
  member,
  comprehension,
  all,
  any,
  and,
  or,
  implies,
  eq,
  neq,
  isIn,
  not,
  type Expr,
} from "./predicate/ast.js";

export { evaluate, satisfies, type EvalValue } from "./predicate/evaluate.js";

export { validate } from "./validate/validate.js";
export { Severity, DiagnosticCode, type Diagnostic } from "./diagnostics/diagnostic.js";
export type { Position, SourceSpan, SourceFile } from "./diagnostics/span.js";
export { check, checkAgainst } from "./api.js";

export {
  toJSON,
  fromJSON,
  graphFromJSON,
  type TodlDocument,
  type JsonNode,
  type JsonEdge,
} from "./emit/json.js";

export { toMetaModule, type MetaModuleOptions } from "./emit/js-module.js";

export { rewrite } from "./migrate/rewriter.js";

export { load, type LoadResult } from "./parse/loader.js";
export { parse, type ParseResult } from "./parse/parser.js";
export { parsePredicate } from "./parse/predicate-parser.js";
export { tokenize, TokenKind, type Token } from "./parse/lexer.js";
