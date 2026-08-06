import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { compilePackage } from "../publish.js";

const META = `namespace ea {
  concept technology { label : string; }
}`;

test("compilePackage: clean sources → ok, document + classes derived", () => {
  const out = compilePackage([], [{ uri: "ea.todl", text: META }], { id: "ea", version: "0.1.0" });
  assert.equal(out.ok, true);
  assert.equal(out.errors.length, 0);
  assert.ok(out.package);
  assert.deepEqual(out.package!.document, toJSON(check([{ uri: "ea.todl", text: META }]).model));
  assert.equal(out.package!.id, "ea");
  assert.equal(out.package!.version, "0.1.0");
});

test("compilePackage: erroring sources → not ok, errors populated, no package", () => {
  const bad = `namespace x { concept c { f : nonexistent-type; } }`;
  const out = compilePackage([], [{ uri: "x.todl", text: bad }], { id: "x", version: "0.1.0" });
  assert.equal(out.ok, false);
  assert.ok(out.errors.length > 0);
  assert.equal(out.package, undefined);
});
