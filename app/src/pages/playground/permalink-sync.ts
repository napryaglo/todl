import { encodeState, decodeState } from "../../../../shared/permalink.js";

/** Read a shared source from the current URL hash, or null if none/invalid.
 *  Isolates all window/location access so PlaygroundVM stays testable. */
export function readSourceFromHash(): string | null {
  return decodeState(typeof window === "undefined" ? "" : window.location.hash)?.source ?? null;
}

export function writeSourceToHash(source: string): void {
  if (typeof window !== "undefined") window.location.hash = encodeState(source);
}

export function copyCurrentLink(): void {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof window !== "undefined")
    void navigator.clipboard.writeText(window.location.href);
}
