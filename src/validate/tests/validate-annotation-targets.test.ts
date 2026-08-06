import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const BASE = `namespace tech {
  concept Actor { label : string; }
  annotation Badge { path : string; }
  taxonomy Actors : represents Actor { `;

function codes(termBody: string): DiagnosticCode[] {
  const src = `${BASE} term Internal { label = "I"; ${termBody} } } }`;
  return check([{ uri: "a.todl", text: src }]).diagnostics.map((d) => d.code);
}

test("the motivating fixture compiles clean", () => {
  const src = `namespace tech {
    concept Actor { label : string; }
    annotation Badge { path : string; }
    taxonomy Actors : represents Actor {
      term Internal {
        label = "Internal";
        annotate Badge { path = "resources/ai_agent.svg"; }
      }
    }
  }`;
  assert.deepEqual(check([{ uri: "a.todl", text: src }]).diagnostics, []);
});

test("a taxonomy-level annotation compiles clean", () => {
  const src = `namespace tech {
    concept Actor { label : string; }
    annotation Badge { path : string; }
    taxonomy Actors : represents Actor {
      annotate Badge { path = "resources/actors.svg"; }
      term Internal { label = "Internal"; }
    }
  }`;
  assert.deepEqual(check([{ uri: "a.todl", text: src }]).diagnostics, []);
});

test("an unknown param on a taxonomy-level annotation is annotation.unknown-param", () => {
  const src = `namespace tech {
    concept Actor { label : string; }
    annotation Badge { path : string; }
    taxonomy Actors : represents Actor {
      annotate Badge { bogus = "x"; }
      term Internal { label = "Internal"; }
    }
  }`;
  assert.ok(check([{ uri: "a.todl", text: src }]).diagnostics.map((d) => d.code).includes(DiagnosticCode.AnnotationUnknownParam));
});

test("an unknown param on a term annotation is annotation.unknown-param", () => {
  assert.ok(codes(`annotate Badge { bogus = "x"; }`).includes(DiagnosticCode.AnnotationUnknownParam));
});

test("a missing required param on a term annotation is cardinality.required-missing", () => {
  assert.ok(codes(`annotate Badge { }`).includes(DiagnosticCode.RequiredMissing));
});

test("a duplicate term annotation is annotation.duplicate", () => {
  assert.ok(
    codes(`annotate Badge { path = "a"; } annotate Badge { path = "b"; }`)
      .includes(DiagnosticCode.AnnotationDuplicate),
  );
});
