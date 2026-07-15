/** Public API for `@pragmatic-lab/todl`. */

export { Signal, type Disposable } from "./core/signal.js";

export {
  Graph,
  Tier,
  EdgeKind,
  Direction,
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
  type PropertyChangedArgs,
  type INotifyPropertyChanged,
} from "./model/reactive.js";

export { Builder } from "./model/builder.js";

export { Model } from "./model/model.js";

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
