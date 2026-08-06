import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON, fromJSON } from "../json.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { MetaKind } from "../../model/kinds.js";

test("annotation def, application node, Annotated edge, and params round-trip", () => {
  const { model } = check([{ uri: "a.todl", text:
    `namespace acme {
      annotation Badge { path : string; }
      concept Actor { annotate Badge { path = "a.svg"; } }
    }` }]);
  const restored = fromJSON(toJSON(model));

  assert.equal(restored.resolve("Badge")!.typeOf, MetaKind.Annotation);
  const app = restored.resolve("Actor@Badge");
  assert.equal(app!.typeOf, "Badge");
  assert.equal(app!.attrs.get("path"), "a.svg");
  assert.deepEqual(restored.related("Actor", EdgeKind.Annotated, Direction.Out), ["Actor@Badge"]);
});

test("a taxonomy-level annotation round-trips through JSON", () => {
  const { model, diagnostics } = check([{ uri: "a.todl", text:
    `namespace acme {
      concept Actor { label : string; }
      annotation Badge { path : string; }
      taxonomy Actors : represents Actor {
        annotate Badge { path = "actors.svg"; }
        term Internal { label = "Internal"; }
      }
    }` }]);
  assert.deepEqual(diagnostics, [], "clean check");
  const restored = fromJSON(toJSON(model));

  const app = restored.resolve("Actors@Badge");
  assert.equal(app!.typeOf, "Badge");
  assert.equal(app!.attrs.get("path"), "actors.svg");
  assert.deepEqual(restored.related("Actors", EdgeKind.Annotated, Direction.Out), ["Actors@Badge"]);
});
