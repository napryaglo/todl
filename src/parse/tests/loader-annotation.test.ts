import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { Tier, EdgeKind, Direction } from "../../model/graph.js";
import { MetaKind, PACKAGE_NODE_ID } from "../../model/kinds.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const SRC = `namespace acme {
  annotation Icon { path : string; }
  annotation Author { name : string; }
  package { annotate Author { name = "Acme"; } }
  concept Actor {
    annotate Icon { path = "icons/actor.svg"; }
    label : string;
  }
}`;

test("an annotation loads as an Ontology-tier node with HasField params", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  const n = model.resolve("Icon");
  assert.equal(n!.tier, Tier.Ontology);
  assert.equal(n!.typeOf, MetaKind.Annotation);
  assert.equal(model.resolve("Icon.path")!.typeOf, MetaKind.Field);
});

test("an application loads as an Annotated node typed by the annotation", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  const app = model.resolve("actor@Icon");
  assert.equal(app!.tier, Tier.Ontology);
  assert.equal(app!.typeOf, "Icon");
  assert.equal(app!.attrs.get("path"), "icons/actor.svg");
  assert.equal(app!.attrs.get("namespace"), "acme");
  assert.deepEqual(model.related("actor", EdgeKind.Annotated, Direction.Out), ["actor@Icon"]);
});

test("package annotations attach to the singleton package node", () => {
  const { model } = load([{ uri: "a.todl", text: SRC }]);
  assert.equal(model.resolve(PACKAGE_NODE_ID)!.typeOf, MetaKind.Package);
  assert.deepEqual(model.related(PACKAGE_NODE_ID, EdgeKind.Annotated, Direction.Out), ["package@Author"]);
});

test("a duplicate application on one target is annotation.duplicate", () => {
  const dup = `namespace acme {
    annotation Icon { path : string; }
    concept Actor {
      annotate Icon { path = "a.svg"; }
      annotate Icon { path = "b.svg"; }
    }
  }`;
  const { diagnostics } = load([{ uri: "a.todl", text: dup }]);
  assert.ok(diagnostics.map((d) => d.code).includes(DiagnosticCode.AnnotationDuplicate));
});

test("annotating an undefined annotation is reference.undefined", () => {
  const bad = `namespace acme { concept Actor { annotate Ghost { x = "y"; } } }`;
  const { diagnostics } = load([{ uri: "a.todl", text: bad }]);
  assert.ok(diagnostics.map((d) => d.code).includes(DiagnosticCode.ReferenceUndefined));
});
