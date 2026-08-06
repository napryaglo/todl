import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { EntityBase } from "../entity.js";
import type { NodeId } from "../graph.js";

class Widget extends EntityBase {
  get label(): string {
    return this.field("label") as string;
  }
}

// A Repository whose `component` nodes hydrate as Widgets via the seam.
class WidgetRepo extends Repository {
  protected override createEntity(id: NodeId): EntityBase {
    return this.resolve(id)?.typeOf === "component" ? new Widget(this, id) : super.createEntity(id);
  }
}

function repo(): WidgetRepo {
  const r = new WidgetRepo();
  const b = r.builder();
  b.defineConcept("component");
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.assertInstance("component", "web");
  b.addRelationship("gw", "peer", "web");
  b.commit();
  return r;
}

test("createEntity routes entity() construction to a typed subclass", () => {
  const r = repo();
  const gw = r.entity("gw")!;
  assert.ok(gw instanceof Widget);
  assert.equal((gw as Widget).label, "Gateway");
});

test("references resolve to the typed handle from the identity map", () => {
  const r = repo();
  const peer = r.entity("gw")!.ref("peer");
  assert.ok(peer instanceof Widget);
  assert.equal(peer, r.entity("web"));
});
