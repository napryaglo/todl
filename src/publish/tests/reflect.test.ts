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

test("deriveClasses returns only class=true Instance clabjects with label + annotation icon", () => {
  assert.deepEqual(deriveClasses(doc()), [
    { id: "ms.az", concept: "location", localId: "az", label: "Azure", icon: "resources/az.svg" },
  ]);
});
