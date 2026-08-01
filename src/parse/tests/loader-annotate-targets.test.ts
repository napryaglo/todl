import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { EdgeKind, Direction, Tier } from "../../model/graph.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const TERM_SRC = `namespace tech {
  concept actor { label : string; }
  annotation icon { path : string; }
  taxonomy actors : represents actor {
    term internal {
      label = "Internal";
      annotate icon { path = "resources/ai_agent.svg"; }
    }
  }
}`;

test("a term annotation stages an Annotated edge and an app node", () => {
  const { model } = load([{ uri: "a.todl", text: TERM_SRC }]);
  assert.deepEqual(
    model.related("actors.internal", EdgeKind.Annotated, Direction.Out),
    ["actors.internal@icon"],
  );
  const app = model.resolve("actors.internal@icon");
  assert.equal(app!.tier, Tier.Ontology);
  assert.equal(app!.typeOf, "icon");
  assert.equal(app!.attrs.get("path"), "resources/ai_agent.svg");
});

test("a class annotation stages an Annotated edge from the class node", () => {
  const { model } = load([{ uri: "a.todl", text: `namespace tech {
    concept component { label : string; }
    annotation icon { path : string; }
    class component web-app { annotate icon { path = "resources/web.svg"; } }
  }` }]);
  assert.deepEqual(
    model.related("web-app", EdgeKind.Annotated, Direction.Out),
    ["web-app@icon"],
  );
});

test("annotate on a concrete instance is annotation.invalid-target", () => {
  const { diagnostics } = load([{ uri: "a.todl", text: `namespace tech {
    concept component { label : string; }
    annotation icon { path : string; }
    model m : tech {
      component storefront { label = "S"; annotate icon { path = "w.svg"; } }
    }
  }` }]);
  assert.ok(diagnostics.map((d) => d.code).includes(DiagnosticCode.AnnotationInvalidTarget));
});
