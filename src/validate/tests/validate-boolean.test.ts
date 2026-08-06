import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(text: string): DiagnosticCode[] {
  return check([{ uri: "a.todl", text }]).diagnostics.map((d) => d.code);
}

test("a boolean annotation param accepting true/false compiles clean", () => {
  assert.deepEqual(codes(`namespace tech {
    concept Actor { label : string; }
    annotation Shelf { visible : boolean; }
    taxonomy Actors : represents Actor {
      annotate Shelf { visible = true; }
      term Internal { label = "Internal"; }
    }
  }`), []);
});

test("a string on a boolean param is type.boolean-invalid", () => {
  assert.ok(codes(`namespace tech {
    concept Actor { label : string; }
    annotation Shelf { visible : boolean; }
    taxonomy Actors : represents Actor {
      annotate Shelf { visible = "yes"; }
      term Internal { label = "Internal"; }
    }
  }`).includes(DiagnosticCode.BooleanValueInvalid));
});

test("a string on a boolean concept field is type.boolean-invalid", () => {
  assert.ok(codes(`namespace tech {
    concept Flag { on : boolean; }
    taxonomy Flags : represents Flag {
      Flag bad { on = "nope"; }
    }
  }`).includes(DiagnosticCode.BooleanValueInvalid));
});
