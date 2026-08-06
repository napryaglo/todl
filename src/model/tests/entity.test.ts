import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { Tier } from "../graph.js";

// component/technology instances plus an `app-component : component` subtype and
// a `web-app` class, and a mutual reference cycle a <-> b via member `peer`.
function fixture(): Repository {
  const repo = new Repository();
  const b = repo.builder();
  b.defineConcept("component");
  b.defineConcept("app-component", "component"); // extends component
  b.defineConcept("technology");
  b.assertInstance("technology", "copilot");
  b.setField("copilot", "label", "Copilot");
  b.assertInstance("component", "gw");
  b.setField("gw", "label", "Gateway");
  b.addRelationship("gw", "implemented-by", "copilot");
  b.assertInstance("app-component", "portal-svc");
  b.assertInstance("component", "web-app", true); // class
  b.setField("web-app", "label", "Web App default");
  b.assertInstance("component", "portal");
  b.addInstanceOf("portal", "web-app");
  b.assertInstance("component", "a");
  b.assertInstance("component", "b");
  b.addRelationship("a", "peer", "b");
  b.addRelationship("b", "peer", "a");
  b.commit();
  return repo;
}

test("entity exposes id, concept, tier, and scalar fields", () => {
  const repo = fixture();
  const gw = repo.entity("gw")!;
  assert.equal(gw.id, "gw");
  assert.equal(gw.concept, "component");
  assert.equal(gw.tier, Tier.Instance);
  assert.equal(gw.field("label"), "Gateway");
});

test("entity() is undefined for a missing node", () => {
  assert.equal(fixture().entity("ghost"), undefined);
});

test("entity() is an identity map: same id yields the same instance", () => {
  const repo = fixture();
  assert.equal(repo.entity("gw"), repo.entity("gw"));
});

test("navigation returns shared handles from the identity map", () => {
  const repo = fixture();
  const gw = repo.entity("gw")!;
  assert.equal(gw.ref("implemented-by"), repo.entity("copilot"));
  assert.equal(gw.ref("implemented-by")!.id, "copilot");
});

test("reference cycles are safe to navigate", () => {
  const repo = fixture();
  const a = repo.entity("a")!;
  assert.equal(a.ref("peer")!.ref("peer"), a);
});

test("refs and referrers return Entity arrays", () => {
  const repo = fixture();
  assert.deepEqual(repo.entity("gw")!.refs("implemented-by").map((e) => e.id), ["copilot"]);
  assert.deepEqual(repo.entity("copilot")!.referrers("implemented-by").map((e) => e.id), ["gw"]);
});

test("type() resolves an instance's concept as an Entity; schema() reflects it", () => {
  const repo = fixture();
  const gw = repo.entity("gw")!;
  assert.equal(gw.type()!.id, "component");
  assert.equal(gw.schema().concept, "component");
});

test("is() is subtype- and instanceOf-aware", () => {
  const repo = fixture();
  assert.equal(repo.entity("gw")!.is("component"), true);
  assert.equal(repo.entity("gw")!.is("technology"), false);
  assert.equal(repo.entity("portal-svc")!.is("component"), true); // via extends
  assert.equal(repo.entity("portal")!.is("web-app"), true); // via instanceof
});

test("fields excludes structural markers but field() reads them by name", () => {
  const repo = fixture();
  const webApp = repo.entity("web-app")!;
  assert.equal(webApp.fields.has("class"), false);
  assert.equal(webApp.fields.get("label"), "Web App default");
  assert.equal(webApp.field("class"), true); // by name, unfiltered
});
