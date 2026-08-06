import { test } from "node:test";
import assert from "node:assert/strict";
import { recaseSource, toPascal, toCamel, toLowerCamel } from "../recase.js";

test("casing helpers split on -, _, and case boundaries (idempotent)", () => {
  assert.equal(toPascal("app-component"), "AppComponent");
  assert.equal(toPascal("AppComponent"), "AppComponent");
  assert.equal(toCamel("hosted-by"), "hostedBy");
  assert.equal(toCamel("HostedBy"), "hostedBy");
  assert.equal(toLowerCamel("meta-models"), "metaModels");
});

test("recases a concept declaration, supertype, and member/type divergence", () => {
  const out = recaseSource(`concept app-component : component { hosted-by : technology; depends-on : depends-on; }`);
  assert.equal(out, `concept AppComponent : Component { hostedBy : Technology; dependsOn : DependsOn; }`);
});

test("leaves built-in primitives lowercase, recases user primitives", () => {
  assert.equal(recaseSource(`primitive resource-key : string { }`), `primitive ResourceKey : string { }`);
  assert.equal(recaseSource(`label : string?;`), `label : string?;`);
  assert.equal(recaseSource(`weight : number;`), `weight : number;`);
});

test("recases taxonomy, represents, and terms; keeps namespaces lowercase", () => {
  const out = recaseSource(`namespace adl.meta-models.bpmn { taxonomy task-type : represents task { term user { label = "User"; } } }`);
  assert.equal(out, `namespace adl.metaModels.bpmn { taxonomy TaskType : represents Task { term User { label = "User"; } } }`);
});

test("recases annotation decl + application; identifier-valued string follows referent", () => {
  assert.equal(recaseSource(`annotation my-badge { path : string; }`), `annotation MyBadge { path : string; }`);
  assert.equal(recaseSource(`annotate my-badge { path = "x"; }`), `annotate MyBadge { path = "x"; }`);
  assert.equal(recaseSource(`annotate instance { concept = "app-component"; }`), `annotate Instance { concept = "AppComponent"; }`);
});

test("recases relationship declaration and arrow target", () => {
  assert.equal(recaseSource(`relationship depends-on -> app-component;`), `relationship DependsOn -> AppComponent;`);
});
