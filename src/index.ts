/** Public API for `@pragmatic-tech-ai/todl`. */

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

export { InMemoryGraphStore, type GraphStore } from "./model/graph-store.js";

export {
  CypherGraphStore,
  type CypherSession,
  type CypherOp,
  type CypherRow,
} from "./model/cypher-store.js";

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

export {
  toElement,
  type Element,
  type ElementSchema,
  type Provenance,
  type IncomingRef,
  type PresentationHint,
  type ToElementOptions,
} from "./model/element.js";

export { FrozenRepository } from "./model/frozen.js";

export { generateReadClient, isReferenceType, type ReadClientOptions } from "./codegen/read-client.js";

export { ModelDraft, type InstanceDescriptor } from "./authoring/model-draft.js";

export { TodlFileStore, type FileIO } from "./authoring/file-store.js";
export { deriveBindings, emitModelTodl, type ModelBindings } from "./emit/todl.js";

export {
  compilePackage,
  publish,
  PackageKind,
  type PackageRef,
  type PackageIdentity,
  type PackageDocument,
  type CompiledPackage,
  type CompileOutcome,
  type PublishOutcome,
} from "./publish/publish.js";
export {
  BlobPackageStore,
  GraphPackageStore,
  type PackageStore,
  type PackageSink,
} from "./publish/stores.js";
export { deriveClasses, projectAnnotations, type PublishedClass } from "./publish/reflect.js";

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
  toJSONOwn,
  fromJSON,
  graphFromJSON,
  type TodlDocument,
  type JsonNode,
  type JsonEdge,
  type EmitOptions,
  type NodeDebug,
  type EdgeDebug,
} from "./emit/json.js";

export { toMetaModule, type MetaModuleOptions } from "./emit/js-module.js";

export { rewrite } from "./migrate/rewriter.js";

export { load, type LoadResult } from "./parse/loader.js";
export { parse, type ParseResult } from "./parse/parser.js";
export { parsePredicate } from "./parse/predicate-parser.js";
export { tokenize, TokenKind, type Token } from "./parse/lexer.js";
