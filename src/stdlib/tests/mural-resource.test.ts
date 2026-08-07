import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../index.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

// icon : MuralResource { key : ResourceKey? } — the inherited `key` param is a
// known param on `icon`, so annotating with it compiles clean.
test("a prelude icon annotation accepts the inherited key param", () => {
  const src = `namespace app {
    concept Thing { label : string; }
    concept Widget : Thing {
      annotate icon { path = "resources/w.svg"; key = "mm_icon_w"; }
    }
  }`;
  assert.deepEqual(check([{ uri: "a.todl", text: src }]).diagnostics, []);
});

// Inheritance did not turn `icon` into an open bag: an unknown param is still rejected.
test("an unknown param on a prelude icon annotation is still annotation.unknown-param", () => {
  const src = `namespace app {
    concept Thing { label : string; }
    concept Widget : Thing {
      annotate icon { path = "resources/w.svg"; bogus = "x"; }
    }
  }`;
  const codes = check([{ uri: "a.todl", text: src }]).diagnostics.map((d) => d.code);
  assert.ok(codes.includes(DiagnosticCode.AnnotationUnknownParam));
});

// The well-known label annotation now exists (lowercase; distinct from primitive Label).
test("a prelude label annotation accepts a text param", () => {
  const src = `namespace app {
    concept Thing { annotate label { text = "A Thing"; } label : string; }
  }`;
  assert.deepEqual(check([{ uri: "a.todl", text: src }]).diagnostics, []);
});
