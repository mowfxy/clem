import type { GucErrorKind } from "../../core/guc/types.ts";

const said: Record<GucErrorKind, string> = {
  auth: "GUC didn't accept your username or password. Sign in again in Settings → Connectors → GUC.",
  site_changed: "GUC changed how its pages look, so Clem couldn't read them. Your saved GUC data is still here.",
  offline: "Clem couldn't reach GUC. It will try again when you're online.",
  unavailable: "GUC isn't answering right now. Clem will try again later.",
};

/** A sync failure Clem can explain. The message is always the friendly one: never a password, URL or server text. */
export class GucError extends Error {
  kind: GucErrorKind;
  /** For the log only (an error code), never shown. */
  detail: string;
  constructor(kind: GucErrorKind, detail = "", message = said[kind]) { super(message); this.name = "GucError"; this.kind = kind; this.detail = detail; }
}

const OFFLINE = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ESOCKETTIMEDOUT", "ECONNABORTED"]);
export function asGucError(error: unknown): GucError {
  if (error instanceof GucError) return error;
  const e = error as { code?: string; name?: string; message?: string };
  if (e?.name === "SiteChanged") return new GucError("site_changed", e.message);
  if (e?.code && OFFLINE.has(e.code)) return new GucError("offline", e.code);
  if (/timed? ?out/i.test(e?.message || "")) return new GucError("offline", "timeout");
  return new GucError("unavailable", e?.code || e?.name || "");
}
