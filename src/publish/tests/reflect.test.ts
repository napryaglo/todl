import { test } from "node:test";
import assert from "node:assert/strict";
import type { TodlDocument } from "../../emit/json.js";
import { deriveClasses, projectAnnotations } from "../reflect.js";

// A compiled doc with one clabject `az` (class=true) carrying a label and an
// `icon` annotation application `az@icon { path = "resources/az.svg" }`.
function doc(): TodlDocument {
  return {
    nodes: [
      { id: "ms.az", tier: "Instance", typeOf: "location", attrs: { id: "az", class: true, label: "Azure" } },
      { id: "ms.az@icon", tier: "Instance", typeOf: "icon", attrs: { path: "resources/az.svg", namespace: "ms" } },
      { id: "ms.Other", tier: "Ontology", typeOf: "concept", attrs: { id: "other" } },
    ],
    edges: [{ kind: "Annotated", via: null, from: "ms.az", to: "ms.az@icon" }],
  };
}

test("projectAnnotations keys applications by annotation name, strips namespace", () => {
  assert.deepEqual(projectAnnotations(doc(), "ms.az"), { icon: { path: "resources/az.svg" } });
  assert.deepEqual(projectAnnotations(doc(), "ms.Missing"), {});
});

// Richer cases (ported from Plexus annotation-projection.test.ts when that copy
// was retired): multiple annotations on one target, dangling edge skipped, and a
// non-Annotated edge ignored.
test("projectAnnotations: multi-annotation, dangling edge skipped, non-annotation edge ignored", () => {
  const doc2: TodlDocument = {
    nodes: [
      { id: "actor", tier: "Ontology", typeOf: "concept", attrs: { label: "Human Actor" } },
      { id: "actor@icon", tier: "Ontology", typeOf: "icon", attrs: { path: "icons/actor.svg", namespace: "acme" } },
      { id: "actor@category", tier: "Ontology", typeOf: "category", attrs: { name: "actors", order: 1, namespace: "acme" } },
      { id: "bare", tier: "Ontology", typeOf: "concept", attrs: {} },
    ],
    edges: [
      { kind: "Annotated", via: null, from: "actor", to: "actor@icon" },
      { kind: "Annotated", via: null, from: "actor", to: "actor@category" },
      { kind: "Annotated", via: null, from: "actor", to: "missing@ghost" }, // dangling → skipped
      { kind: "HasField", via: null, from: "actor", to: "Actor.name" }, // non-annotation edge ignored
    ],
  };
  assert.deepEqual(projectAnnotations(doc2, "actor"), {
    icon: { path: "icons/actor.svg" },
    category: { name: "actors", order: 1 },
  });
  assert.deepEqual(projectAnnotations(doc2, "bare"), {});
});

test("projectAnnotations indexes an application under its annotation's ancestors (polymorphism)", () => {
  // detailed : visual ; X carries @detailed → queryable as detailed AND visual.
  const doc2: TodlDocument = {
    nodes: [
      { id: "visual", tier: "Ontology", typeOf: "annotation", attrs: {} },
      { id: "detailed", tier: "Ontology", typeOf: "annotation", attrs: {} },
      { id: "X", tier: "Ontology", typeOf: "concept", attrs: {} },
      { id: "X@detailed", tier: "Ontology", typeOf: "detailed", attrs: { icon: "a.svg", badge: "new", namespace: "n" } },
    ],
    edges: [
      { kind: "Extends", via: null, from: "detailed", to: "visual" },
      { kind: "Annotated", via: null, from: "X", to: "X@detailed" },
    ],
  };
  const got = projectAnnotations(doc2, "X");
  assert.deepEqual(got.detailed, { icon: "a.svg", badge: "new" });
  assert.deepEqual(got.visual, { icon: "a.svg", badge: "new" }); // is-a base
});

test("deriveClasses returns only class=true Instance clabjects with label + annotation icon", () => {
  assert.deepEqual(deriveClasses(doc()), [
    { id: "ms.az", concept: "location", localId: "az", label: "Azure", icon: "resources/az.svg" },
  ]);
});

// An own-only document holds the class + its annotation APPLICATION, but not the
// base annotation-declaration nodes. An icon reachable only via the
// `special : icon` inheritance chain is therefore lost from the own document
// alone, and recovered when annotations are projected from the full closure.
test("deriveClasses resolves inherited icons from an optional annotationsFrom document", () => {
  const ownDoc: TodlDocument = {
    nodes: [
      { id: "X", tier: "Instance", typeOf: "widget", attrs: { id: "x", class: true, label: "X" } },
      { id: "X@special", tier: "Instance", typeOf: "special", attrs: { path: "s.svg", namespace: "lib" } },
    ],
    edges: [{ kind: "Annotated", via: null, from: "X", to: "X@special" }],
  };
  const fullDoc: TodlDocument = {
    nodes: [
      ...ownDoc.nodes,
      { id: "widget", tier: "Ontology", typeOf: "concept", attrs: {} },
      { id: "special", tier: "Ontology", typeOf: "annotation", attrs: {} },
      { id: "icon", tier: "Ontology", typeOf: "annotation", attrs: {} },
    ],
    edges: [...ownDoc.edges, { kind: "Extends", via: null, from: "special", to: "icon" }],
  };

  // Own-only: class found, inherited icon lost.
  const ownOnly = deriveClasses(ownDoc);
  assert.equal(ownOnly.length, 1);
  assert.equal(ownOnly[0].id, "X");
  assert.equal(ownOnly[0].icon, undefined);

  // Enriched from the full document: the special→icon chain resolves the icon.
  const enriched = deriveClasses(ownDoc, fullDoc);
  assert.equal(enriched.length, 1, "still enumerates only the own class");
  assert.equal(enriched[0].icon, "s.svg");
});
