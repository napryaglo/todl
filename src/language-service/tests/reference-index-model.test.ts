import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../parse/parser.js";
import { buildReferenceIndex, Role } from "../reference-index.js";

function indexOf(src: string, uri = "d.todl") {
  return buildReferenceIndex(new Map([[uri, parse(src, uri).namespace]]));
}

test("a concept referenced from inside a model body is indexed", () => {
  const idx = indexOf([
    "namespace app {",
    "  concept component { }",
    "  model prod : app {",
    "    component checkout { }",
    "  }",
    "}",
  ].join("\n"));
  const refs = idx.get("component");
  assert.ok(refs.some((r) => r.role === Role.InstanceConcept));
});

test("an instanceof target referenced from inside a model body is indexed", () => {
  const idx = indexOf([
    "namespace app {",
    "  concept component { }",
    "  class component base { }",
    "  model prod : app {",
    "    component c instanceof base { }",
    "  }",
    "}",
  ].join("\n"));
  const refs = idx.get("base");
  assert.ok(refs.some((r) => r.role === Role.InstanceOf));
});
