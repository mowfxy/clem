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

export async function handleUsage(request, env, user, path) {
  if (path !== "/usage" || request.method !== "POST") return null;
  const body = await readJson(request);
  if (!Array.isArray(body.days) || body.days.length > 14) throw new HttpError(400, "Send at most 14 days.");
  const oldest = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
  const newest = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const statements = [];
  for (const entry of body.days) {
    const day = String(entry?.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < oldest || day > newest) throw new HttpError(400, "Invalid usage day.");
    if (!Array.isArray(entry.rows) || entry.rows.length > 40) throw new HttpError(400, "Too many usage rows.");
    // Each report carries the day's running totals, so a resend replaces instead of adding.
    for (const row of entry.rows) {
      const provider = label(row.provider);
      if (!PROVIDERS.has(provider)) throw new HttpError(400, "Unknown provider.");
      statements.push(
        env.DB.prepare(
          "INSERT INTO desktop_usage(user_id,day,provider,model,reasoning,turns,images) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,day,provider,model,reasoning) DO UPDATE SET turns=MAX(turns,excluded.turns),images=MAX(images,excluded.images)",
        ).bind(user.id, day, provider, label(row.model) || "default", label(row.reasoning), count(row.turns), count(row.images)),
      );
    }
    if (entry.hours !== undefined) {
      if (!Array.isArray(entry.hours) || entry.hours.length !== 24) throw new HttpError(400, "Invalid hours.");
      statements.push(
        env.DB.prepare(
          "INSERT INTO desktop_usage_hours(user_id,day,hours) VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET hours=excluded.hours",
        ).bind(user.id, day, entry.hours.map((h) => count(h)).join(",")),
      );
    }
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true });
}
