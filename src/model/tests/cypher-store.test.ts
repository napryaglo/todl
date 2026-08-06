import { test } from "node:test";
import assert from "node:assert/strict";
import { Tier, EdgeKind, type Node, type Edge, type NodeId } from "../graph.js";
import { CypherGraphStore, type CypherSession, type CypherRow, type CypherOp } from "../cypher-store.js";

function node(id: NodeId, typeOf = "thing", attrs: Record<string, string> = {}): Node {
  return { id, tier: Tier.Instance, typeOf, attrs: new Map(Object.entries(attrs)) };
}
function edge(from: NodeId, to: NodeId, via: NodeId | null = "rel"): Edge {
  return { kind: EdgeKind.Relationship, via, from, to };
}

class RecordingSession implements CypherSession {
  readonly calls: CypherOp[] = [];
  async run(cypher: string, params: Record<string, unknown> = {}): Promise<CypherRow[]> {
    this.calls.push({ cypher, params });
    return [];
  }
}

test("mutations record the mapped Cypher ops (applied to the working copy first)", () => {
  const s = new CypherGraphStore();
  s.addNode(node("copilot", "technology", { label: "Copilot" }));
  s.addNode(node("gw", "component"));
  s.addEdge(edge("gw", "copilot", "implemented-by"));
  s.setAttr("gw", "label", "Gateway");
  s.remove("copilot");

  // working copy reflects the writes synchronously
  assert.equal(s.getNode("gw")?.attrs.get("label"), "Gateway");
  assert.equal(s.hasNode("copilot"), false);

  const ops = s.pendingCypher();
  assert.deepEqual(ops[0], {
    cypher: "CREATE (n:Node {id: $id}) SET n.tier = $tier, n.typeOf = $typeOf, n += $attrs",
    params: { id: "copilot", tier: "Instance", typeOf: "technology", attrs: { label: "Copilot" } },
  });
  assert.deepEqual(ops[2], {
    cypher: "MATCH (a:Node {id: $from}), (b:Node {id: $to}) CREATE (a)-[:REL {kind: $kind, via: $via}]->(b)",
    params: { from: "gw", to: "copilot", kind: "Relationship", via: "implemented-by" },
  });
  assert.deepEqual(ops[3], {
    cypher: "MATCH (n:Node {id: $id}) SET n += $delta",
    params: { id: "gw", delta: { label: "Gateway" } },
  });
  assert.deepEqual(ops[4], {
    cypher: "MATCH (n:Node {id: $id}) DETACH DELETE n",
    params: { id: "copilot" },
  });
});

test("a failed mutation records no Cypher op (working-copy validation runs first)", () => {
  const s = new CypherGraphStore();
  s.addNode(node("a"));
  assert.throws(() => s.addEdge(edge("a", "ghost")), /does not exist/);
  assert.throws(() => s.addNode(node("a")), /already exists/);
  assert.equal(s.pendingCypher().length, 1); // only the first addNode
});

test("flush runs every pending op through the session in order, then clears", async () => {
  const s = new CypherGraphStore();
  s.addNode(node("a"));
  s.addNode(node("b"));
  s.addEdge(edge("a", "b"));
  const session = new RecordingSession();
  await s.flush(session);
  assert.deepEqual(session.calls.map((c) => c.cypher[0]), ["C", "C", "M"]); // CREATE, CREATE, MATCH
  assert.equal(session.calls.length, 3);
  assert.equal(s.pendingCypher().length, 0); // cleared after flush
});
