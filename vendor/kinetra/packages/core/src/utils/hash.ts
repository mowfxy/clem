import { createHash } from "node:crypto";

/** Stable SHA-256 hex digest. Used to fingerprint source documents and chunks. */
export function sha256(input: string | Uint8Array): string {
  const h = createHash("sha256");
  if (typeof input === "string") h.update(input, "utf8");
  else h.update(input);
  return h.digest("hex");
}

/** Shortened 12-character digest for display. */
export function shortHash(s: string): string {
  return s.slice(0, 12);
}
