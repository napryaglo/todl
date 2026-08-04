import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../api.js";
import { toJSON } from "../emit/json.js";

test("a migrated-style library compiles clean: bare siblings + uses cross-refs", () => {
  const base = toJSON(check([{ uri: "ea.todl", text:
    `namespace tech-architecture {
       concept location { label : string; parent : location?; }
       concept category { label : string; }
       concept technology { label : string; available-in : location; applicable-to : categories; }
       taxonomy categories : represents category {
         term platform-api { label = "API"; }
         term conversational-interface { label = "Chat"; }
       }
     }` }]).model);

  const lib = `namespace libraries.microsoft {
    import tech-architecture;
    taxonomy microsoft-tech : represents location, technology uses categories {
      location azure { label = "Azure"; }
      location m365  { label = "Microsoft 365"; parent = azure; }
      technology graph {
        label = "Microsoft Graph";
        available-in  = [m365];
        applicable-to = [platform-api];
      }
      technology teams {
        label = "Microsoft Teams";
        available-in  = [m365];
        applicable-to = [conversational-interface];
      }
    }
  }`;

  const { diagnostics } = checkAgainst([base], [{ uri: "microsoft.todl", text: lib }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), [], "library compiles clean");
});
