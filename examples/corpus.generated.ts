// GENERATED from examples/ by scripts/gen-corpus.mjs — do not edit by hand.
import type { CorpusEntry } from "../shared/corpus-types.js";

export const CORPUS: CorpusEntry[] = [
  {
    "manifest": {
      "id": "check-against",
      "title": "Compiling against a published base",
      "group": "Bases",
      "order": 80,
      "tags": [
        "checkAgainst",
        "base",
        "multi-file"
      ],
      "narrative": "A model can be compiled against an already-published base (a meta-model or library) supplied as a compiled document rather than re-parsed source. Here `base.todl` defines the `acme.ea` meta-model; `main.todl` is checked against it and instantiates `acme.ea.Component` by its qualified name. The manifest marks `base.todl` as a base, so the verifier routes it through `checkAgainst`.",
      "files": [
        "base.todl",
        "main.todl"
      ],
      "bases": [
        "base.todl"
      ],
      "expectClean": true
    },
    "sources": [
      {
        "name": "base.todl",
        "text": "namespace acme.ea {\n  concept Component { label : string; }\n}\n"
      },
      {
        "name": "main.todl",
        "text": "namespace acme.app {\n  model AppModel : acme.ea { acme.ea.Component web { label = \"Web\"; } }\n}\n"
      }
    ],
    "golden": {
      "diagnostics": [],
      "document": {
        "nodes": [
          {
            "id": "#n0",
            "tier": "Instance",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "acme.app",
              "id": "AppModel",
              "MetaModel": "acme.ea",
              "uses.count": 0
            }
          },
          {
            "id": "#n1",
            "tier": "Instance",
            "typeOf": "#r1",
            "attrs": {
              "namespace": "acme.app",
              "id": "web",
              "label": "Web"
            }
          }
        ],
        "edges": [
          {
            "kind": "Contains",
            "via": null,
            "from": "#n0",
            "to": "#n1"
          }
        ]
      }
    },
    "dir": "bases/check-against"
  },
  {
    "manifest": {
      "id": "inline-objects",
      "title": "Anonymous inline object literals",
      "group": "Objects",
      "order": 50,
      "tags": [
        "inline-object",
        "nested"
      ],
      "narrative": "A member typed by a concept can be assigned an anonymous inline object — `slot { environment = \"prod\"; }` — instead of a reference to a named instance. The loader materializes it as a contained child of the owning instance.",
      "files": [
        "m.todl"
      ],
      "expectClean": true
    },
    "sources": [
      {
        "name": "m.todl",
        "text": "namespace sys {\n  concept slot { environment : string; }\n  concept component { slots : slot[]; }\n  model M : sys { component c1 { slots = [ slot { environment = \"prod\"; } ]; } }\n}\n"
      }
    ],
    "golden": {
      "diagnostics": [],
      "document": {
        "nodes": [
          {
            "id": "#n0",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "sys"
            }
          },
          {
            "id": "#n1",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "sys"
            }
          },
          {
            "id": "#n2",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "name": "environment",
              "cardinality": 0,
              "type": "string",
              "namespace": "sys"
            }
          },
          {
            "id": "#n3",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "name": "slots",
              "cardinality": 2,
              "type": "slot",
              "namespace": "sys"
            }
          },
          {
            "id": "#n4",
            "tier": "Instance",
            "typeOf": "#r2",
            "attrs": {
              "namespace": "sys",
              "id": "M",
              "MetaModel": "sys",
              "uses.count": 0
            }
          },
          {
            "id": "#n5",
            "tier": "Instance",
            "typeOf": "#n1",
            "attrs": {
              "namespace": "sys",
              "id": "c1"
            }
          },
          {
            "id": "#n6",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "namespace": "sys",
              "id": "g0",
              "environment": "prod"
            }
          }
        ],
        "edges": [
          {
            "kind": "Extends",
            "via": null,
            "from": "#n0",
            "to": "#r3"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n0",
            "to": "#n2"
          },
          {
            "kind": "Extends",
            "via": null,
            "from": "#n1",
            "to": "#r3"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n1",
            "to": "#n3"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n4",
            "to": "#n5"
          },
          {
            "kind": "Relationship",
            "via": "#r4",
            "from": "#n5",
            "to": "#n6"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n5",
            "to": "#n6"
          }
        ]
      }
    },
    "dir": "objects/inline-objects"
  },
  {
    "manifest": {
      "id": "missing-required",
      "title": "Intentional error: a required member is missing",
      "group": "Errors",
      "order": 90,
      "tags": [
        "diagnostic",
        "cardinality",
        "error"
      ],
      "narrative": "Not every example is meant to compile clean. `Component.label` is required (no `?`), so the instance `c` that omits it yields a `cardinality.required-missing` diagnostic. This example proves the harness captures failures, not just success — its golden carries the expected error.",
      "files": [
        "m.todl"
      ],
      "expectClean": false
    },
    "sources": [
      {
        "name": "m.todl",
        "text": "namespace app {\n  concept Component { label : string; }\n  model M : app { Component c { } }\n}\n"
      }
    ],
    "golden": {
      "diagnostics": [
        {
          "code": "cardinality.required-missing",
          "severity": "error",
          "message": "required \"Component.label\" is missing on \"c\"",
          "path": "Component.label",
          "span": {
            "uri": "m.todl",
            "start": {
              "line": 3,
              "column": 19
            },
            "end": {
              "line": 3,
              "column": 34
            }
          }
        }
      ],
      "document": {
        "nodes": [
          {
            "id": "#n0",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "app"
            }
          },
          {
            "id": "#n1",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "name": "label",
              "cardinality": 0,
              "type": "string",
              "namespace": "app"
            }
          },
          {
            "id": "#n2",
            "tier": "Instance",
            "typeOf": "#r2",
            "attrs": {
              "namespace": "app",
              "id": "M",
              "MetaModel": "app",
              "uses.count": 0
            }
          },
          {
            "id": "#n3",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "namespace": "app",
              "id": "c"
            }
          }
        ],
        "edges": [
          {
            "kind": "Extends",
            "via": null,
            "from": "#n0",
            "to": "#r3"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n0",
            "to": "#n1"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n2",
            "to": "#n3"
          }
        ]
      }
    },
    "dir": "errors/missing-required"
  },
  {
    "manifest": {
      "id": "operator-edges",
      "title": "Author-defined operator materializing edges",
      "group": "Operators",
      "order": 30,
      "tags": [
        "operator",
        "connector",
        "edge"
      ],
      "narrative": "An `operator` declares an infix glyph over a reified relationship concept. `~> : connector (from, to)` means the statement `a ~> b` mints a `connector` whose `from` is `a` and `to` is `b`. Operators turn edge-heavy models into readable infix statements.",
      "files": [
        "m.todl"
      ],
      "expectClean": true
    },
    "sources": [
      {
        "name": "m.todl",
        "text": "namespace flow {\n  concept endpoint { label : string; }\n  concept connector { from : endpoint; to : endpoint; }\n  operator ~> : connector (from, to);\n  model M : flow { endpoint a { label = \"a\"; } endpoint b { label = \"b\"; } a ~> b; }\n}\n"
      }
    ],
    "golden": {
      "diagnostics": [],
      "document": {
        "nodes": [
          {
            "id": "#n0",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "flow"
            }
          },
          {
            "id": "#n1",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "flow"
            }
          },
          {
            "id": "#n2",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "namespace": "flow",
              "from": "from",
              "to": "to"
            }
          },
          {
            "id": "#n3",
            "tier": "Ontology",
            "typeOf": "#r2",
            "attrs": {
              "name": "label",
              "cardinality": 0,
              "type": "string",
              "namespace": "flow"
            }
          },
          {
            "id": "#n4",
            "tier": "Ontology",
            "typeOf": "#r2",
            "attrs": {
              "name": "from",
              "cardinality": 0,
              "type": "endpoint",
              "namespace": "flow"
            }
          },
          {
            "id": "#n5",
            "tier": "Ontology",
            "typeOf": "#r2",
            "attrs": {
              "name": "to",
              "cardinality": 0,
              "type": "endpoint",
              "namespace": "flow"
            }
          },
          {
            "id": "#n6",
            "tier": "Instance",
            "typeOf": "#r3",
            "attrs": {
              "namespace": "flow",
              "id": "M",
              "MetaModel": "flow",
              "uses.count": 0
            }
          },
          {
            "id": "#n7",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "namespace": "flow",
              "id": "a",
              "label": "a"
            }
          },
          {
            "id": "#n8",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "namespace": "flow",
              "id": "b",
              "label": "b"
            }
          },
          {
            "id": "#n9",
            "tier": "Instance",
            "typeOf": "#n1",
            "attrs": {
              "namespace": "flow",
              "id": "g0"
            }
          }
        ],
        "edges": [
          {
            "kind": "Extends",
            "via": null,
            "from": "#n0",
            "to": "#r4"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n0",
            "to": "#n3"
          },
          {
            "kind": "Extends",
            "via": null,
            "from": "#n1",
            "to": "#r4"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n1",
            "to": "#n4"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n1",
            "to": "#n5"
          },
          {
            "kind": "Targets",
            "via": null,
            "from": "#n2",
            "to": "#n1"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n6",
            "to": "#n7"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n6",
            "to": "#n8"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n6",
            "to": "#n9"
          },
          {
            "kind": "Relationship",
            "via": "#r5",
            "from": "#n9",
            "to": "#n7"
          },
          {
            "kind": "Relationship",
            "via": "#r6",
            "from": "#n9",
            "to": "#n8"
          }
        ]
      }
    },
    "dir": "operators/operator-edges"
  },
  {
    "manifest": {
      "id": "operator-value",
      "title": "Operator expression as a value",
      "group": "Operators",
      "order": 40,
      "tags": [
        "operator",
        "value",
        "array"
      ],
      "narrative": "An operator expression like `a ~> b` is not only a statement — it is a value. Here it appears inside an array assigned to `net.links`, so the minted `connector` is captured as an element of a relationship member rather than as a free-standing statement.",
      "files": [
        "m.todl"
      ],
      "expectClean": true
    },
    "sources": [
      {
        "name": "m.todl",
        "text": "namespace flow {\n  concept endpoint { label : string; }\n  concept connector { from : endpoint; to : endpoint; }\n  concept net { links : connector[]; }\n  operator ~> : connector (from, to);\n  model M : flow { endpoint a { label = \"a\"; } endpoint b { label = \"b\"; } net n { links = [ a ~> b ]; } }\n}\n"
      }
    ],
    "golden": {
      "diagnostics": [],
      "document": {
        "nodes": [
          {
            "id": "#n0",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "flow"
            }
          },
          {
            "id": "#n1",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "flow"
            }
          },
          {
            "id": "#n10",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "namespace": "flow",
              "id": "b",
              "label": "b"
            }
          },
          {
            "id": "#n11",
            "tier": "Instance",
            "typeOf": "#n2",
            "attrs": {
              "namespace": "flow",
              "id": "n"
            }
          },
          {
            "id": "#n12",
            "tier": "Instance",
            "typeOf": "#n1",
            "attrs": {
              "namespace": "flow",
              "id": "g0"
            }
          },
          {
            "id": "#n2",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "flow"
            }
          },
          {
            "id": "#n3",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "namespace": "flow",
              "from": "from",
              "to": "to"
            }
          },
          {
            "id": "#n4",
            "tier": "Ontology",
            "typeOf": "#r2",
            "attrs": {
              "name": "label",
              "cardinality": 0,
              "type": "string",
              "namespace": "flow"
            }
          },
          {
            "id": "#n5",
            "tier": "Ontology",
            "typeOf": "#r2",
            "attrs": {
              "name": "from",
              "cardinality": 0,
              "type": "endpoint",
              "namespace": "flow"
            }
          },
          {
            "id": "#n6",
            "tier": "Ontology",
            "typeOf": "#r2",
            "attrs": {
              "name": "to",
              "cardinality": 0,
              "type": "endpoint",
              "namespace": "flow"
            }
          },
          {
            "id": "#n7",
            "tier": "Ontology",
            "typeOf": "#r2",
            "attrs": {
              "name": "links",
              "cardinality": 2,
              "type": "connector",
              "namespace": "flow"
            }
          },
          {
            "id": "#n8",
            "tier": "Instance",
            "typeOf": "#r3",
            "attrs": {
              "namespace": "flow",
              "id": "M",
              "MetaModel": "flow",
              "uses.count": 0
            }
          },
          {
            "id": "#n9",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "namespace": "flow",
              "id": "a",
              "label": "a"
            }
          }
        ],
        "edges": [
          {
            "kind": "Extends",
            "via": null,
            "from": "#n0",
            "to": "#r4"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n0",
            "to": "#n4"
          },
          {
            "kind": "Relationship",
            "via": "#r5",
            "from": "#n11",
            "to": "#n12"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n11",
            "to": "#n12"
          },
          {
            "kind": "Relationship",
            "via": "#r6",
            "from": "#n12",
            "to": "#n9"
          },
          {
            "kind": "Relationship",
            "via": "#r7",
            "from": "#n12",
            "to": "#n10"
          },
          {
            "kind": "Extends",
            "via": null,
            "from": "#n1",
            "to": "#r4"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n1",
            "to": "#n5"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n1",
            "to": "#n6"
          },
          {
            "kind": "Extends",
            "via": null,
            "from": "#n2",
            "to": "#r4"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n2",
            "to": "#n7"
          },
          {
            "kind": "Targets",
            "via": null,
            "from": "#n3",
            "to": "#n1"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n8",
            "to": "#n9"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n8",
            "to": "#n10"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n8",
            "to": "#n11"
          }
        ]
      }
    },
    "dir": "operators/operator-value"
  },
  {
    "manifest": {
      "id": "prelude-element",
      "title": "Extending the prelude root concept",
      "group": "Basics",
      "order": 10,
      "tags": [
        "prelude",
        "concept",
        "model"
      ],
      "narrative": "Every parent-less concept implicitly extends the prelude's root `Element`, which contributes optional `label` and `description` members. Here `Product` extends `Element` explicitly and adds its own `sku`; a `model` block carries the instance (bare instances outside a model are orphans).",
      "files": [
        "m.todl"
      ],
      "expectClean": true
    },
    "sources": [
      {
        "name": "m.todl",
        "text": "namespace shop {\n  concept Product : Element { sku : string; }\n  model Catalog : shop { Product widget { label = \"Widget\"; description = \"A widget\"; sku = \"W-1\"; } }\n}\n"
      }
    ],
    "golden": {
      "diagnostics": [],
      "document": {
        "nodes": [
          {
            "id": "#n0",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "shop"
            }
          },
          {
            "id": "#n1",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "name": "sku",
              "cardinality": 0,
              "type": "string",
              "namespace": "shop"
            }
          },
          {
            "id": "#n2",
            "tier": "Instance",
            "typeOf": "#r2",
            "attrs": {
              "namespace": "shop",
              "id": "Catalog",
              "MetaModel": "shop",
              "uses.count": 0
            }
          },
          {
            "id": "#n3",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "namespace": "shop",
              "id": "widget",
              "label": "Widget",
              "description": "A widget",
              "sku": "W-1"
            }
          }
        ],
        "edges": [
          {
            "kind": "Extends",
            "via": null,
            "from": "#n0",
            "to": "#r3"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n0",
            "to": "#n1"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n2",
            "to": "#n3"
          }
        ]
      }
    },
    "dir": "basics/prelude-element"
  },
  {
    "manifest": {
      "id": "qualified-resolution",
      "title": "Qualified name resolution across namespaces",
      "group": "Namespaces",
      "order": 60,
      "tags": [
        "namespace",
        "qualified",
        "resolve",
        "multi-file"
      ],
      "narrative": "A namespace is a visibility gate: a symbol from another namespace resolves by its fully-qualified name. Across two files, `app.Widget` extends `lib.Base` by qualifying the supertype with its home namespace — the loader resolves it to a cross-namespace `Extends` edge. (Note: TODL declares one namespace per file, so the two namespaces are separate files.)",
      "files": [
        "lib.todl",
        "app.todl"
      ],
      "expectClean": true
    },
    "sources": [
      {
        "name": "lib.todl",
        "text": "namespace lib {\n  concept Base { id : string; }\n}\n"
      },
      {
        "name": "app.todl",
        "text": "namespace app {\n  concept Widget : lib.Base { color : string; }\n}\n"
      }
    ],
    "golden": {
      "diagnostics": [],
      "document": {
        "nodes": [
          {
            "id": "#n0",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "lib"
            }
          },
          {
            "id": "#n1",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "app"
            }
          },
          {
            "id": "#n2",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "name": "id",
              "cardinality": 0,
              "type": "string",
              "namespace": "lib"
            }
          },
          {
            "id": "#n3",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "name": "color",
              "cardinality": 0,
              "type": "string",
              "namespace": "app"
            }
          }
        ],
        "edges": [
          {
            "kind": "Extends",
            "via": null,
            "from": "#n0",
            "to": "#r2"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n0",
            "to": "#n2"
          },
          {
            "kind": "Extends",
            "via": null,
            "from": "#n1",
            "to": "#n0"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n1",
            "to": "#n3"
          }
        ]
      }
    },
    "dir": "namespaces/qualified-resolution"
  },
  {
    "manifest": {
      "id": "taxonomy-bare",
      "title": "Bare term resolution across a taxonomy",
      "group": "Resolution",
      "order": 20,
      "tags": [
        "taxonomy",
        "resolve"
      ],
      "narrative": "A bare identifier used as a reference value inside a term body resolves against the enclosing taxonomy's own sibling terms — no `<taxonomy>.<term>` qualification required. Here `m365`'s `parent = azure` resolves to the sibling term `azure`.",
      "files": [
        "m.todl"
      ],
      "expectClean": true
    },
    "sources": [
      {
        "name": "m.todl",
        "text": "namespace tech {\n  concept Platform { parent : Platform?; }\n  taxonomy Stack : represents Platform {\n    term azure {}\n    term m365 { parent = azure; }\n  }\n}\n"
      }
    ],
    "golden": {
      "diagnostics": [],
      "document": {
        "nodes": [
          {
            "id": "#n0",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "tech"
            }
          },
          {
            "id": "#n1",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "namespace": "tech"
            }
          },
          {
            "id": "#n2",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "class": true,
              "id": "azure",
              "namespace": "tech"
            }
          },
          {
            "id": "#n3",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "class": true,
              "id": "m365",
              "namespace": "tech"
            }
          },
          {
            "id": "#n4",
            "tier": "Ontology",
            "typeOf": "#r2",
            "attrs": {
              "name": "parent",
              "cardinality": 1,
              "type": "Platform",
              "namespace": "tech"
            }
          }
        ],
        "edges": [
          {
            "kind": "Extends",
            "via": null,
            "from": "#n0",
            "to": "#r3"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n0",
            "to": "#n4"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n1",
            "to": "#n2"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n1",
            "to": "#n3"
          },
          {
            "kind": "Represents",
            "via": null,
            "from": "#n1",
            "to": "#n0"
          },
          {
            "kind": "Relationship",
            "via": "#r4",
            "from": "#n3",
            "to": "#n2"
          }
        ]
      }
    },
    "dir": "resolution/taxonomy-bare"
  },
  {
    "manifest": {
      "id": "type-directed",
      "title": "Type-directed references: edge vs. attribute",
      "group": "References",
      "order": 70,
      "tags": [
        "reference",
        "edge",
        "attribute"
      ],
      "narrative": "A member's value is interpreted by its declared type: a primitive-typed member (`name : string`) stores an attribute, while a concept-typed member (`depends : Component?`) mints a graph edge to the referenced instance. Same value syntax, different meaning — driven entirely by the type.",
      "files": [
        "m.todl"
      ],
      "expectClean": true
    },
    "sources": [
      {
        "name": "m.todl",
        "text": "namespace ea {\n  concept Component { name : string; depends : Component?; }\n  model M : ea { Component a { name = \"a\"; } Component b { name = \"b\"; depends = a; } }\n}\n"
      }
    ],
    "golden": {
      "diagnostics": [],
      "document": {
        "nodes": [
          {
            "id": "#n0",
            "tier": "Ontology",
            "typeOf": "#r0",
            "attrs": {
              "namespace": "ea"
            }
          },
          {
            "id": "#n1",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "name": "name",
              "cardinality": 0,
              "type": "string",
              "namespace": "ea"
            }
          },
          {
            "id": "#n2",
            "tier": "Ontology",
            "typeOf": "#r1",
            "attrs": {
              "name": "depends",
              "cardinality": 1,
              "type": "Component",
              "namespace": "ea"
            }
          },
          {
            "id": "#n3",
            "tier": "Instance",
            "typeOf": "#r2",
            "attrs": {
              "namespace": "ea",
              "id": "M",
              "MetaModel": "ea",
              "uses.count": 0
            }
          },
          {
            "id": "#n4",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "namespace": "ea",
              "id": "a",
              "name": "a"
            }
          },
          {
            "id": "#n5",
            "tier": "Instance",
            "typeOf": "#n0",
            "attrs": {
              "namespace": "ea",
              "id": "b",
              "name": "b"
            }
          }
        ],
        "edges": [
          {
            "kind": "Extends",
            "via": null,
            "from": "#n0",
            "to": "#r3"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n0",
            "to": "#n1"
          },
          {
            "kind": "HasField",
            "via": null,
            "from": "#n0",
            "to": "#n2"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n3",
            "to": "#n4"
          },
          {
            "kind": "Contains",
            "via": null,
            "from": "#n3",
            "to": "#n5"
          },
          {
            "kind": "Relationship",
            "via": "#r4",
            "from": "#n5",
            "to": "#n4"
          }
        ]
      }
    },
    "dir": "references/type-directed"
  }
];
