import { describeGraphStore } from "./graph-store-conformance.js";
import { InMemoryGraphStore } from "../graph-store.js";

describeGraphStore("InMemoryGraphStore", () => new InMemoryGraphStore());
