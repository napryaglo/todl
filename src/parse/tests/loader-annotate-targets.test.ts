import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { EdgeKind, Direction, Tier } from "../../model/graph.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const TERM_SRC = `namespace tech {
  concept Actor { label : string; }
  annotation Icon { path : string; }
  taxonomy Actors : represents Actor {
    term Internal {
      label = "Internal";
      annotate Icon { path = "resources/ai_agent.svg"; }
    }
  }
}`;

test("a term annotation stages an Annotated edge and an app node", () => {
  const { model } = load([{ uri: "a.todl", text: TERM_SRC }]);
  assert.deepEqual(
    model.related("Actors.Internal", EdgeKind.Annotated, Direction.Out),
    ["Actors.Internal@Icon"],
  );
  const app = model.resolve("Actors.Internal@Icon");
  assert.equal(app!.tier, Tier.Ontology);
  assert.equal(app!.typeOf, "Icon");
  assert.equal(app!.attrs.get("path"), "resources/ai_agent.svg");
});

test("a taxonomy-level annotation stages an Annotated edge from the taxonomy node", () => {
  const { model, diagnostics } = load([{ uri: "a.todl", text: `namespace tech {
    concept Actor { label : string; }
    annotation Icon { path : string; }
    taxonomy Actors : represents Actor {
      annotate Icon { path = "resources/actors.svg"; }
      term Internal { label = "Internal"; }
    }
  }` }]);
  assert.deepEqual(diagnostics, [], "clean load");
  assert.deepEqual(
    model.related("Actors", EdgeKind.Annotated, Direction.Out),
    ["Actors@Icon"],
  );
  const app = model.resolve("Actors@Icon");
  assert.equal(app!.tier, Tier.Ontology);
  assert.equal(app!.typeOf, "Icon");
  assert.equal(app!.attrs.get("path"), "resources/actors.svg");
});

test("taxonomy-level and term-level annotations coexist on distinct nodes", () => {
  const { model } = load([{ uri: "a.todl", text: `namespace tech {
    concept Actor { label : string; }
    annotation Icon { path : string; }
    taxonomy Actors : represents Actor {
      annotate Icon { path = "tax.svg"; }
      term Internal { annotate Icon { path = "term.svg"; } }
    }
  }` }]);
  assert.equal(model.resolve("Actors@Icon")!.attrs.get("path"), "tax.svg");
  assert.equal(model.resolve("Actors.Internal@Icon")!.attrs.get("path"), "term.svg");
});

test("a class annotation stages an Annotated edge from the class node", () => {
  const { model } = load([{ uri: "a.todl", text: `namespace tech {
    concept Component { label : string; }
    annotation Icon { path : string; }
    class Component webApp { annotate Icon { path = "resources/web.svg"; } }
  }` }]);
  assert.deepEqual(
    model.related("webApp", EdgeKind.Annotated, Direction.Out),
    ["webApp@Icon"],
  );
});

test("annotate on a concrete instance is annotation.invalid-target", () => {
  const { diagnostics } = load([{ uri: "a.todl", text: `namespace tech {
    concept Component { label : string; }
    annotation Icon { path : string; }
    model m : tech {
      Component storefront { label = "S"; annotate Icon { path = "w.svg"; } }
    }
  }` }]);
  assert.ok(diagnostics.map((d) => d.code).includes(DiagnosticCode.AnnotationInvalidTarget));
});
