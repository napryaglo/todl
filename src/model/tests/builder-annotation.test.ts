import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, Tier, EdgeKind, Direction } from "../graph.js";
import { MetaKind, PACKAGE_NODE_ID } from "../kinds.js";
import { Builder } from "../builder.js";

test("defineAnnotation stages an Ontology-tier MetaKind.Annotation node", () => {
  const g = new Graph();
  new Builder(g).defineAnnotation("icon").commit();
  const n = g.getNode("icon");
  assert.equal(n!.tier, Tier.Ontology);
  assert.equal(n!.typeOf, MetaKind.Annotation);
});

test("annotate stages an application node typed by the annotation + an Annotated edge", () => {
  const g = new Graph();
  const b = new Builder(g);
  b.defineConcept("actor").defineAnnotation("icon");
  const appId = b.annotate("actor", "icon");
  b.setField(appId, "path", "a.svg");
  b.commit();
  assert.equal(appId, "actor@icon");
  const app = g.getNode("actor@icon");
  assert.equal(app!.tier, Tier.Ontology);
  assert.equal(app!.typeOf, "icon");
  assert.equal(app!.attrs.get("path"), "a.svg");
  assert.deepEqual(g.related("actor", EdgeKind.Annotated, Direction.Out), ["actor@icon"]);
});

test("definePackageNode stages the singleton package node", () => {
  const g = new Graph();
  new Builder(g).definePackageNode(PACKAGE_NODE_ID).commit();
  const n = g.getNode(PACKAGE_NODE_ID);
  assert.equal(n!.typeOf, MetaKind.Package);
});
