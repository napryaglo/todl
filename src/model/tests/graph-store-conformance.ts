import { test } from "node:test";
import assert from "node:assert/strict";
import { Tier, EdgeKind, type Node, type Edge, type NodeId } from "../graph.js";
import type { GraphStore } from "../graph-store.js";

function node(id: NodeId, typeOf = "thing"): Node {
  return { id, tier: Tier.Instance, typeOf, attrs: new Map() };
}
function edge(from: NodeId, to: NodeId, via: NodeId | null = "rel"): Edge {
  return { kind: EdgeKind.Relationship, via, from, to };
}

/** Contract every GraphStore backend must satisfy (spec §9). Phase 7 reuses this. */
export function describeGraphStore(name: string, make: () => GraphStore): void {
  test(`${name}: addNode / getNode / hasNode / nodeCount`, () => {
    const s = make();
    assert.equal(s.hasNode("a"), false);
    s.addNode(node("a"));
    assert.equal(s.hasNode("a"), true);
    assert.equal(s.getNode("a")?.id, "a");
    assert.equal(s.nodeCount, 1);
    assert.throws(() => s.addNode(node("a")), /already exists/);
  });

  test(`${name}: instancesOf indexes by typeOf`, () => {
    const s = make();
    s.addNode(node("a", "component"));
    s.addNode(node("b", "component"));
    s.addNode(node("c", "technology"));
    assert.deepEqual([...s.instancesOf("component")].sort(), ["a", "b"]);
    assert.deepEqual([...s.instancesOf("technology")], ["c"]);
    assert.deepEqual([...s.instancesOf("nope")], []);
  });

  test(`${name}: addEdge + outEdges / inEdges`, () => {
    const s = make();
    s.addNode(node("a"));
    s.addNode(node("b"));
    s.addEdge(edge("a", "b"));
    assert.deepEqual(s.outEdges("a").map((e) => e.to), ["b"]);
    assert.deepEqual(s.inEdges("b").map((e) => e.from), ["a"]);
    assert.deepEqual(s.outEdges("b"), []);
  });

  test(`${name}: addEdge throws on a missing endpoint`, () => {
    const s = make();
    s.addNode(node("a"));
    assert.throws(() => s.addEdge(edge("a", "ghost")), /target .*does not exist/);
    assert.throws(() => s.addEdge(edge("ghost", "a")), /source .*does not exist/);
  });

  test(`${name}: setAttr sets a scalar (throws for a missing node)`, () => {
    const s = make();
    s.addNode(node("a"));
    s.setAttr("a", "label", "A");
    assert.equal(s.getNode("a")?.attrs.get("label"), "A");
    assert.throws(() => s.setAttr("ghost", "x", 1), /does not exist/);
  });

  test(`${name}: remove deletes the node, its edges, and its type-index entry`, () => {
    const s = make();
    s.addNode(node("a", "component"));
    s.addNode(node("b"));
    s.addEdge(edge("a", "b"));
    s.addEdge(edge("b", "a"));
    s.remove("a");
    assert.equal(s.hasNode("a"), false);
    assert.deepEqual([...s.instancesOf("component")], []);
    assert.deepEqual(s.inEdges("b"), []); // a->b detached
    assert.deepEqual(s.outEdges("b"), []); // b->a detached
    assert.throws(() => s.remove("a"), /does not exist/);
  });

  test(`${name}: allNodes returns every node; commit is callable`, () => {
    const s = make();
    s.addNode(node("a"));
    s.addNode(node("b"));
    assert.deepEqual([...s.allNodes()].map((n) => n.id).sort(), ["a", "b"]);
    s.commit(); // no throw
  });
}
