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

  assert.equal(restored.resolve("badge")!.typeOf, MetaKind.Annotation);
  const app = restored.resolve("actor@badge");
  assert.equal(app!.typeOf, "badge");
  assert.equal(app!.attrs.get("path"), "a.svg");
  assert.deepEqual(restored.related("actor", EdgeKind.Annotated, Direction.Out), ["actor@badge"]);
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

  const app = restored.resolve("actors@badge");
  assert.equal(app!.typeOf, "badge");
  assert.equal(app!.attrs.get("path"), "Actors.svg");
  assert.deepEqual(restored.related("actors", EdgeKind.Annotated, Direction.Out), ["actors@badge"]);
});
