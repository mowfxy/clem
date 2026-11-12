// Telegram pairing (docs/DESKTOP.md "Telegram"): a 6-digit code, kept only as an HMAC, single use, 10 minutes. Pure,
// shared by the account Worker (cloudflare/telegram.js) and the tests; WebCrypto only, so it runs in a Worker and Node.

export const CODE_TTL_MS = 10 * 60_000;
/** Codes one account can ask for in an hour. */
export const CODES_PER_HOUR = 5;
/** Codes one Telegram chat can try in a minute. */
export const TRIES_PER_MINUTE = 5;
/** Telegram's own limit for a file a bot sends. */
export const TG_FILE_LIMIT = 50 * 1024 * 1024;
/** Telegram's limit for one message's text. */
export const TG_TEXT_LIMIT = 4096;

/** Six digits, uniformly (rejection sampling keeps every code equally likely). */
export function newCode(random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  for (;;) { const n = random() >>> 0; if (n < 4_294_000_000) return String(n % 1_000_000).padStart(6, "0"); }
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
/** The code as stored: HMAC-SHA256 under a Worker secret, so the table alone gives no code away. */
export async function codeHash(code: string, pepper: string) {
  if (!pepper) throw Error("Telegram isn't configured.");
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("tg-pair:" + code)));
}

/** A code in what the person sent: "/start 123456" (the t.me link), "123456" or "123 456". */
export function readCode(text: string | undefined): string | null {
  const t = String(text || "").trim();
  const m = /^\/start(?:@\w+)?\s+(\d{6})$/.exec(t) || /^(\d{3})[\s-]?(\d{3})$/.exec(t);
  return m ? (m[2] ? m[1] + m[2] : m[1]) : null;
}

/** Whether an account may have another code, given how many it asked for this hour. */
export const canIssue = (askedThisHour: number) => askedThisHour < CODES_PER_HOUR;
/** Whether a code is still good: not expired (and, by being deleted when used, never used). */
export const live = (row: { expires_at: number } | null | undefined, now: number) => !!row && row.expires_at > now;
/** The link that opens the bot with the code filled in. */
export const deepLink = (bot: string, code: string) => `https://t.me/${encodeURIComponent(bot)}?start=${code}`;
/** "4:05" left, for the countdown. */
export const left = (expires: number, now: number) => { const s = Math.max(0, Math.ceil((expires - now) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Inline keyboards the Worker sends: tap buttons carry an engine token ("b:…", under Telegram's 64 bytes), links https. */
export type Key = { text: string; data: string } | { text: string; url: string };
export function keyboardOk(rows: unknown): rows is Key[][] {
  if (!Array.isArray(rows) || rows.length > 12) return false;
  return rows.every((row) => Array.isArray(row) && row.length >= 1 && row.length <= 4 && row.every((k) => k && typeof k.text === "string" && k.text.length >= 1 && k.text.length <= 64
    && (typeof k.data === "string" ? /^b:[\w-]{1,40}$/.test(k.data) && k.url === undefined : typeof k.url === "string" && /^https:\/\/[^\s]{1,500}$/.test(k.url))));
}
