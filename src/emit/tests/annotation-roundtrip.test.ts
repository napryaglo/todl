import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON, fromJSON } from "../json.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { MetaKind } from "../../model/kinds.js";

test("annotation def, application node, Annotated edge, and params round-trip", () => {
  const { model } = check([{ uri: "a.todl", text:
    `namespace acme {
      annotation badge { path : string; }
      concept actor { annotate badge { path = "a.svg"; } }
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
      concept actor { label : string; }
      annotation badge { path : string; }
      taxonomy actors : represents actor {
        annotate badge { path = "actors.svg"; }
        term internal { label = "Internal"; }
      }
    }` }]);
  assert.deepEqual(diagnostics, [], "clean check");
  const restored = fromJSON(toJSON(model));

  const app = restored.resolve("actors@badge");
  assert.equal(app!.typeOf, "badge");
  assert.equal(app!.attrs.get("path"), "actors.svg");
  assert.deepEqual(restored.related("actors", EdgeKind.Annotated, Direction.Out), ["actors@badge"]);
});
