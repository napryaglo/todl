import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../api.js";
import { toJSON } from "../emit/json.js";

test("a migrated-style library compiles clean: bare siblings + uses cross-refs", () => {
  const base = toJSON(check([{ uri: "ea.todl", text:
    `namespace techArchitecture {
       concept Location { label : string; parent : Location?; }
       concept Category { label : string; }
       concept Technology { label : string; availableIn : Location; applicableTo : Categories; }
       taxonomy Categories : represents Category {
         term PlatformApi { label = "API"; }
         term ConversationalInterface { label = "Chat"; }
       }
     }` }]).model);

  const lib = `namespace libraries.microsoft {
    import tech-architecture;
    taxonomy MicrosoftTech : represents Location, Technology uses Categories {
      Location azure { label = "Azure"; }
      Location m365  { label = "Microsoft 365"; parent = azure; }
      Technology graph {
        label = "Microsoft Graph";
        availableIn  = [m365];
        applicableTo = [platformApi];
      }
      Technology teams {
        label = "Microsoft Teams";
        availableIn  = [m365];
        applicableTo = [conversationalInterface];
      }
    }
  }`;

  const { diagnostics } = checkAgainst([base], [{ uri: "microsoft.todl", text: lib }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), [], "library compiles clean");
});
