import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(text: string): DiagnosticCode[] {
  return check([{ uri: "a.todl", text }]).diagnostics.map((d) => d.code);
}

test("a boolean annotation param accepting true/false compiles clean", () => {
  assert.deepEqual(codes(`namespace tech {
    concept actor { label : string; }
    annotation toolbox { visible : boolean; }
    taxonomy actors : represents actor {
      annotate toolbox { visible = true; }
      term internal { label = "Internal"; }
    }
  }`), []);
});

test("a string on a boolean param is type.boolean-invalid", () => {
  assert.ok(codes(`namespace tech {
    concept actor { label : string; }
    annotation toolbox { visible : boolean; }
    taxonomy actors : represents actor {
      annotate toolbox { visible = "yes"; }
      term internal { label = "Internal"; }
    }
  }`).includes(DiagnosticCode.BooleanValueInvalid));
});

test("a string on a boolean concept field is type.boolean-invalid", () => {
  assert.ok(codes(`namespace tech {
    concept flag { on : boolean; }
    taxonomy flags : represents flag {
      flag bad { on = "nope"; }
    }
  }`).includes(DiagnosticCode.BooleanValueInvalid));
});
