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
      { id: "ms.other", tier: "Ontology", typeOf: "concept", attrs: { id: "other" } },
    ],
    edges: [{ kind: "Annotated", via: null, from: "ms.az", to: "ms.az@icon" }],
  };
}

test("projectAnnotations keys applications by annotation name, strips namespace", () => {
  assert.deepEqual(projectAnnotations(doc(), "ms.az"), { icon: { path: "resources/az.svg" } });
  assert.deepEqual(projectAnnotations(doc(), "ms.missing"), {});
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
      { kind: "HasField", via: null, from: "actor", to: "actor.name" }, // non-annotation edge ignored
    ],
  };
  assert.deepEqual(projectAnnotations(doc2, "actor"), {
    icon: { path: "icons/actor.svg" },
    category: { name: "actors", order: 1 },
  });
  assert.deepEqual(projectAnnotations(doc2, "bare"), {});
});

test("deriveClasses returns only class=true Instance clabjects with label + annotation icon", () => {
  assert.deepEqual(deriveClasses(doc()), [
    { id: "ms.az", concept: "location", localId: "az", label: "Azure", icon: "resources/az.svg" },
  ]);
});
