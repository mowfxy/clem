// Connected ChatGPT (Codex) and Claude sign-ins, kept with the Mowr account so a reinstall or a new
// PC reconnects them after signing in to Mowr. Each credential is deflated, then encrypted with
// AES-GCM under PROVIDER_VAULT_KEY, bound to its owner and connection id, and stored as one compact
// BLOB (IV + ciphertext). Entries are returned only to their owner.
import { pack, unpack } from "./lib/pack.js";
import { HttpError, readJson } from "./lib/http.js";

const KINDS = new Set(["codex", "claude", "telegram"]);
const MAX_ITEMS = 12, MAX_BYTES = 64_000;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function key(env) {
  if (!env.PROVIDER_VAULT_KEY) throw Error("Account linking is not configured.");
  const raw = Uint8Array.from(atob(env.PROVIDER_VAULT_KEY), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw Error("Account linking is misconfigured.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const bound = (userId, id) => new TextEncoder().encode(userId + ":" + id);

async function seal(env, userId, id, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bound(userId, id) }, await key(env), await pack(text)));
  const out = new Uint8Array(12 + cipher.length);
  out.set(iv); out.set(cipher, 12);
  return out;
}
async function open(k, userId, id, sealed) {
  const bytes = sealed instanceof Uint8Array ? sealed : new Uint8Array(sealed);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: bound(userId, id) }, k, bytes.subarray(12));
  return unpack(new Uint8Array(plain));
}

export async function handleProviders(request, env, user, path) {
  if (path !== "/providers" && !path.startsWith("/providers/")) return undefined;
  try {
    if (path === "/providers" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id,kind,label,hash,sealed,updated_at FROM provider_links WHERE user_id=? ORDER BY created_at").bind(user.id).all();
      const k = await key(env);
      const items = [];
      for (const row of results) {
        try { items.push({ id: row.id, kind: row.kind, label: row.label, hash: row.hash, updatedAt: row.updated_at, data: await open(k, user.id, row.id, row.sealed) }); }
        catch { /* An entry that no longer decrypts is skipped; the owner can reconnect it. */ }
      }
      return json({ items });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    // The credential arrives as a JSON string inside JSON, so escaping can make the body up to about twice its size.
    const body = await readJson(request, MAX_BYTES * 3);
    const id = String(body.id || "");
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return json({ error: "Invalid connection." }, 400);
    if (path === "/providers/delete") {
      await env.DB.prepare("DELETE FROM provider_links WHERE user_id=? AND id=?").bind(user.id, id).run();
      return json({ ok: true });
    }
    if (path === "/providers/put") {
      const kind = String(body.kind || ""), data = String(body.data || ""), label = String(body.label || "").slice(0, 120), hash = String(body.hash || "").slice(0, 64);
      if (!KINDS.has(kind)) return json({ error: "Unsupported provider." }, 400);
      if (!data || data.length > MAX_BYTES) return json({ error: "Invalid credentials." }, 400);
      try { JSON.parse(data); } catch { return json({ error: "Invalid credentials." }, 400); }
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_links WHERE user_id=? AND id<>?").bind(user.id, id).first();
      if ((count?.n || 0) >= MAX_ITEMS) return json({ error: "Remove a connected account before adding another." }, 400);
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare("INSERT INTO provider_links(user_id,id,kind,label,hash,sealed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET kind=excluded.kind,label=excluded.label,hash=excluded.hash,sealed=excluded.sealed,updated_at=excluded.updated_at")
        .bind(user.id, id, kind, label, hash, await seal(env, user.id, id, data), now, now).run();
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("Account linking failed", error?.message);
    return json({ error: "Account linking is unavailable. Try again shortly." }, 500);
  }
}
