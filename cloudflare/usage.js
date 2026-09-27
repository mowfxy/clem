// The desktop app reports anonymous daily usage counts: provider, model, reasoning level and message totals. No content.
import { HttpError, json, readJson } from "./lib/http.js";

const PROVIDERS = new Set(["chatgpt", "claude", "grok"]);
const label = (value) => {
  const text = String(value ?? "");
  if (text.length > 64 || !/^[\w.:\-]*$/.test(text)) throw new HttpError(400, "Invalid usage label.");
  return text;
};
const count = (value, max = 20000) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, "Invalid usage count.");
  return n;
};

// Each PC reports its own running totals, so rows are kept per device and summed across devices by the stats.
// The app may name its device; otherwise the sign-in session stands in for it (one per PC sign-in). Stored hashed.
async function deviceKey(request, body) {
  let source = typeof body.device === "string" && /^[\w-]{8,64}$/.test(body.device) ? "device:" + body.device : "";
  if (!source) {
    try {
      const part = (request.headers.get("Authorization") || "").slice(7).split(".")[1];
      const session = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))).session_id;
      if (typeof session === "string" && session) source = "session:" + session;
    } catch { /* No session claim: fall back to one shared row, as before. */ }
  }
  if (!source) return "";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
  return Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleUsage(request, env, user, path) {
  if (path !== "/usage" || request.method !== "POST") return null;
  const body = await readJson(request);
  const device = await deviceKey(request, body);
  if (!Array.isArray(body.days) || body.days.length > 14) throw new HttpError(400, "Send at most 14 days.");
  const oldest = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
  const newest = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const statements = [];
  for (const entry of body.days) {
    const day = String(entry?.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < oldest || day > newest) throw new HttpError(400, "Invalid usage day.");
    if (!Array.isArray(entry.rows) || entry.rows.length > 40) throw new HttpError(400, "Too many usage rows.");
    // Each report carries this device's running totals for the day, so a resend replaces instead of adding.
    for (const row of entry.rows) {
      const provider = label(row.provider);
      if (!PROVIDERS.has(provider)) throw new HttpError(400, "Unknown provider.");
      statements.push(
        env.DB.prepare(
          "INSERT INTO desktop_usage(user_id,day,device,provider,model,reasoning,turns,images) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,day,device,provider,model,reasoning) DO UPDATE SET turns=MAX(turns,excluded.turns),images=MAX(images,excluded.images)",
        ).bind(user.id, day, device, provider, label(row.model) || "default", label(row.reasoning), count(row.turns), count(row.images)),
      );
    }
    if (entry.hours !== undefined) {
      if (!Array.isArray(entry.hours) || entry.hours.length !== 24) throw new HttpError(400, "Invalid hours.");
      statements.push(
        env.DB.prepare(
          "INSERT INTO desktop_usage_hours(user_id,day,device,hours) VALUES(?,?,?,?) ON CONFLICT(user_id,day,device) DO UPDATE SET hours=excluded.hours",
        ).bind(user.id, day, device, entry.hours.map((h) => count(h)).join(",")),
      );
    }
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true });
}
