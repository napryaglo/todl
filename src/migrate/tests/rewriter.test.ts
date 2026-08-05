import { test } from "node:test";
import assert from "node:assert/strict";

import { rewrite } from "../rewriter.js";

test("strips legacy @ and current & reference sigils to bare names", () => {
  assert.equal(rewrite("implemented-by = @m365;"), "implemented-by = m365;");
  assert.equal(rewrite("implemented-by = &m365;"), "implemented-by = m365;");
  assert.equal(rewrite("realised-by = [ @a, &b ];"), "realised-by = [ a, b ];");
});

test("rewrites [0..1] cardinality to ?", () => {
  assert.equal(rewrite("implemented-by : identifier [0..1];"), "implemented-by : identifier?;");
});

test("rewrites legacy enum/values to taxonomy/terms", () => {
  const out = rewrite(`enum color {\n  values {\n    | red { label = "Red"; }\n  }\n}`);
  assert.match(out, /taxonomy color \{/);
  assert.match(out, /terms \{/);
  assert.doesNotMatch(out, /\benum\b/);
  assert.doesNotMatch(out, /\bvalues\b/);
});

test("rewrites [1..*] cardinality to [+]", () => {
  assert.equal(rewrite("lanes : pool [1..*];"), "lanes : pool[+];");
});

test("rewrites bare [*] cardinality to []", () => {
  assert.equal(rewrite("relationship realised-by -> technology [*];"), "relationship realised-by -> technology[];");
});

test("drops a redundant [1] cardinality", () => {
  assert.equal(rewrite("id : identifier [1];"), "id : identifier;");
});

test("rewrites list<T> [*] to T[]", () => {
  assert.equal(rewrite("realised-by : list<technology> [*];"), "realised-by : technology[];");
});

test("rewrites a bare list<T> to T[]", () => {
  assert.equal(rewrite("views : list<view>;"), "views : view[];");
});

test("lowers a nested list<object{ list<...> }> innermost-first", () => {
  const out = rewrite("slots : list<object { ports : list<ingress-kind> [*]; }> [*];");
  assert.match(out, /slots : object \{ ports : ingress-kind\[\]; \}\[\];/);
});
