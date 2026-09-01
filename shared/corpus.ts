// shared/corpus.ts — binds the pure accessors to the generated corpus.
import { CORPUS } from "../examples/corpus.generated.js";
import { byId as _byId, groups as _groups, byGroup as _byGroup } from "./corpus-access.js";

export { CORPUS };
export const byId = (id: string) => _byId(CORPUS, id);
export const groups = () => _groups(CORPUS);
export const byGroup = () => _byGroup(CORPUS);
