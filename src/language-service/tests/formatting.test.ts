import { test } from "node:test";
import assert from "node:assert/strict";
import { formatText } from "../formatting.js";

test("re-indents by brace depth and trims trailing space", () => {
  const input = "namespace demo {\nconcept a {\nname : string;   \n}\n}\n";
  const output = formatText(input);
  assert.equal(output, [
    "namespace demo {",
    "  concept a {",
    "    name : string;",
    "  }",
    "}",
    "",
  ].join("\n"));
});

test("is idempotent and preserves comments", () => {
  const input = "namespace demo {\n// a comment\nconcept a { }\n}\n";
  const once = formatText(input);
  assert.equal(formatText(once), once);       // idempotent
  assert.match(once, /\/\/ a comment/);        // comment preserved
});

test("does not treat braces inside strings or comments as blocks", () => {
  const input = 'namespace demo {\nprimitive s { regex = "a{b}c"; }\n}\n';
  const output = formatText(input);
  // The inline `{`/`}` in the string must not change indentation depth.
  assert.equal(output, [
    "namespace demo {",
    '  primitive s { regex = "a{b}c"; }',
    "}",
    "",
  ].join("\n"));
});
