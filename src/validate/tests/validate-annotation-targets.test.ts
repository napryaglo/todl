import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const BASE = `namespace tech {
  concept actor { label : string; }
  annotation icon { path : string; }
  taxonomy actors : represents actor { `;

function codes(termBody: string): DiagnosticCode[] {
  const src = `${BASE} term internal { label = "I"; ${termBody} } } }`;
  return check([{ uri: "a.todl", text: src }]).diagnostics.map((d) => d.code);
}

test("the motivating fixture compiles clean", () => {
  const src = `namespace tech {
    concept actor { label : string; }
    annotation icon { path : string; }
    taxonomy actors : represents actor {
      term internal {
        label = "Internal";
        annotate icon { path = "resources/ai_agent.svg"; }
      }
    }
  }`;
  assert.deepEqual(check([{ uri: "a.todl", text: src }]).diagnostics, []);
});

test("an unknown param on a term annotation is annotation.unknown-param", () => {
  assert.ok(codes(`annotate icon { bogus = "x"; }`).includes(DiagnosticCode.AnnotationUnknownParam));
});

test("a missing required param on a term annotation is cardinality.required-missing", () => {
  assert.ok(codes(`annotate icon { }`).includes(DiagnosticCode.RequiredMissing));
});

test("a duplicate term annotation is annotation.duplicate", () => {
  assert.ok(
    codes(`annotate icon { path = "a"; } annotate icon { path = "b"; }`)
      .includes(DiagnosticCode.AnnotationDuplicate),
  );
});
