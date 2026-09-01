import type { ExampleSource, Golden } from "./corpus-types.js";
import { compileForDisplay } from "./compile-for-display.js";

/** Compare a single live editor source against a committed golden. Both sides
 *  run through the same normalize path, so a stable-key stringify compare is
 *  sound. `summary` is a short human hint — the JSON tab carries the detail. */
export function compareToGolden(source: ExampleSource, golden: Golden): { matches: boolean; summary: string } {
  const live = compileForDisplay([source]);
  const matches =
    JSON.stringify({ d: live.diagnostics, n: live.document }) ===
    JSON.stringify({ d: golden.diagnostics, n: golden.document });
  if (matches) return { matches: true, summary: "matches golden" };
  const dn = live.document.nodes.length - golden.document.nodes.length;
  const dd = live.diagnostics.length - golden.diagnostics.length;
  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return { matches: false, summary: `diverged (nodes ${fmt(dn)}, diagnostics ${fmt(dd)})` };
}
