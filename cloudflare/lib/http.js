// Shared helpers for the account Worker and its route modules.
export const allowedOrigins = new Set([
  "https://admin.m4labs.xyz",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export function corsHeaders(request) {
  const origin = request?.headers.get("Origin");
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Reads a bounded JSON body; route handlers never see oversized or malformed payloads. */
export async function readJson(request, max = 64000) {
  const raw = await request.text();
  if (raw.length > max) throw new HttpError(413, "Request is too large.");
  try {
    const value = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value;
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}

export async function limit(env, key, max) {
  const now = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare(
    "INSERT INTO desktop_rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=excluded.expires RETURNING count",
  )
    .bind(key, now, now)
    .first();
  return row.count <= max;
}

export async function lemon(env, path, body, method) {
  const r = await fetch("https://api.lemonsqueezy.com/v1/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Authorization: "Bearer " + env.LEMON_API_KEY,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error("Payment provider unavailable.");
  return r.json();
}

export const now = () => new Date().toISOString();

export function text(value, max, { required = true, min = 1 } = {}) {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null)) return "";
    throw new HttpError(400, "Invalid text field.");
  }
  const trimmed = value.trim();
  if ((required && trimmed.length < min) || trimmed.length > max)
    throw new HttpError(400, `Enter between ${min} and ${max} characters.`);
  return trimmed;
}
