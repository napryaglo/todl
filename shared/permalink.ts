// Runtime-agnostic base64url (no Buffer, no btoa) so the pure module round-trips
// under node (tests) and in the browser identically.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToB64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : "";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "";
  }
  return out;
}

function b64urlToBytes(s: string): Uint8Array | null {
  const lut = new Map([...B64].map((c, i) => [c, i] as const));
  const out: number[] = [];
  let bits = 0, acc = 0;
  for (const ch of s) {
    const v = lut.get(ch);
    if (v === undefined) return null;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

export function encodeState(source: string): string {
  return "s=" + bytesToB64url(new TextEncoder().encode(source));
}

export function decodeState(hash: string): { source: string } | null {
  const m = hash.replace(/^[#?]/, "").split("&").find((p) => p.startsWith("s="));
  if (!m) return null;
  const bytes = b64urlToBytes(m.slice(2));
  if (!bytes) return null;
  try { return { source: new TextDecoder().decode(bytes) }; } catch { return null; }
}
