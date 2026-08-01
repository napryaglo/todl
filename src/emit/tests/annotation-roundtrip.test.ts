import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON, fromJSON } from "../json.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { MetaKind } from "../../model/kinds.js";

test("annotation def, application node, Annotated edge, and params round-trip", () => {
  const { model } = check([{ uri: "a.todl", text:
    `namespace acme {
      annotation icon { path : string; }
      concept actor { annotate icon { path = "a.svg"; } }
    }` }]);
  const restored = fromJSON(toJSON(model));

  assert.equal(restored.resolve("icon")!.typeOf, MetaKind.Annotation);
  const app = restored.resolve("actor@icon");
  assert.equal(app!.typeOf, "icon");
  assert.equal(app!.attrs.get("path"), "a.svg");
  assert.deepEqual(restored.related("actor", EdgeKind.Annotated, Direction.Out), ["actor@icon"]);
});

test("a taxonomy-level annotation round-trips through JSON", () => {
  const { model, diagnostics } = check([{ uri: "a.todl", text:
    `namespace acme {
      concept actor { label : string; }
      annotation icon { path : string; }
      taxonomy actors : represents actor {
        annotate icon { path = "actors.svg"; }
        term internal { label = "Internal"; }
      }
    }` }]);
  assert.deepEqual(diagnostics, [], "clean check");
  const restored = fromJSON(toJSON(model));

  const app = restored.resolve("actors@icon");
  assert.equal(app!.typeOf, "icon");
  assert.equal(app!.attrs.get("path"), "actors.svg");
  assert.deepEqual(restored.related("actors", EdgeKind.Annotated, Direction.Out), ["actors@icon"]);
});
