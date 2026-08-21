import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import type { SourceFile } from "../../diagnostics/span.js";
import { compilePackage, PackageKind } from "../publish.js";

const META_SRC = `namespace ea {
  concept Technology { label : string; }
}`;
const META: SourceFile = { uri: "ea.todl", text: META_SRC };

// A base meta-model + a library taxonomy over its concepts (proven-clean shape).
const BASE: SourceFile = {
  uri: "meta.todl",
  text: `namespace ea {
    concept Location   { label : string; }
    concept Technology { label : string; }
  }`,
};
const LIB: SourceFile = {
  uri: "lib.todl",
  text: `namespace lib {
    import ea;
    taxonomy Microsoft : represents Location, Technology {
      Location azure { label = "Azure"; }
      Technology azureOpenai { label = "Azure OpenAI"; }
    }
  }`,
};

describe("compilePackage", () => {
  test("clean sources → ok; document is own-only, fullDocument is the closure", () => {
    const out = compilePackage([], [META], { id: "ea", version: "0.1.0" });
    assert.equal(out.ok, true);
    assert.equal(out.errors.length, 0);
    assert.ok(out.package);
    const pkg = out.package!;

    const ownIds = new Set(pkg.document.nodes.map((n) => n.id));
    assert.ok(ownIds.has("Technology"), "own concept present");
    assert.ok(!ownIds.has("identifier"), "prelude node excluded from own document");
    assert.equal(pkg.document.dependencies, undefined, "no deps → field omitted");

    // fullDocument is the whole compiled closure (prelude included).
    assert.ok(pkg.fullDocument.nodes.some((n) => n.id === "identifier"), "fullDocument has prelude");
    assert.equal(pkg.id, "ea");
    assert.equal(pkg.version, "0.1.0");
  });

  test("erroring sources → not ok, errors populated, no package", () => {
    const bad: SourceFile = { uri: "x.todl", text: `namespace x { concept C { f : NonexistentType; } }` };
    const out = compilePackage([], [bad], { id: "x", version: "0.1.0" });
    assert.equal(out.ok, false);
    assert.ok(out.errors.length > 0);
    assert.equal(out.package, undefined);
  });

  test("against a base: document excludes base nodes and records dependencies", () => {
    const base = toJSON(check([BASE]).model);
    const deps = [{ kind: PackageKind.MetaModel, id: "ea", version: "1.0.0" }];
    const out = compilePackage([base], [LIB], { id: "lib", version: "0.1.0" }, deps);
    assert.ok(out.ok && out.package);
    const pkg = out.package!;

    const ownIds = new Set(pkg.document.nodes.map((n) => n.id));
    assert.ok(ownIds.has("Microsoft.azure"), "own class term present");
    assert.ok(!ownIds.has("Location"), "base concept excluded from own document");
    assert.ok(!ownIds.has("identifier"), "prelude excluded from own document");
    assert.deepEqual(pkg.document.dependencies, deps, "dependencies recorded");

    // fullDocument still carries the base concept.
    assert.ok(pkg.fullDocument.nodes.some((n) => n.id === "Location"), "fullDocument has base");
    // Derived classes are own-only.
    assert.ok(pkg.classes.some((c) => c.id === "Microsoft.azure"));
    assert.ok(!pkg.classes.some((c) => c.id === "Location"));
  });
});
