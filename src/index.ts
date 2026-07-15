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

export { Builder } from "./model/builder.js";

export {
  Model,
  type FieldSchema,
  type RelationshipSchema,
  type ConceptSchema,
} from "./model/model.js";

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

export { validate, Severity, DiagnosticCode, type Diagnostic } from "./validate/validate.js";

export {
  toJSON,
  fromJSON,
  type TodlDocument,
  type JsonNode,
  type JsonEdge,
} from "./emit/json.js";
