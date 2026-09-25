// Connected ChatGPT (Codex) and Claude sign-ins, kept with the Mowr account so a reinstall or a new
// PC reconnects them after signing in to Mowr. Credentials are encrypted at rest with AES-GCM under
// PROVIDER_VAULT_KEY, bound to the owner and connection id, and returned only to their owner.

const KINDS = new Set(["codex", "claude"]);
const MAX_ITEMS = 12, MAX_BYTES = 64_000;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function key(env) {
  if (!env.PROVIDER_VAULT_KEY) throw Error("Account linking is not configured.");
  const raw = unb64(env.PROVIDER_VAULT_KEY);
  if (raw.length !== 32) throw Error("Account linking is misconfigured.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const bound = (userId, id) => new TextEncoder().encode(userId + ":" + id);

export async function handleProviders(request, env, user, path) {
  if (path !== "/providers" && !path.startsWith("/providers/")) return undefined;
  try {
    if (path === "/providers" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id,kind,label,hash,iv,payload,updated_at FROM provider_links WHERE user_id=? ORDER BY created_at").bind(user.id).all();
      const k = await key(env);
      const items = [];
      for (const row of results) {
        try {
          const data = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv), additionalData: bound(user.id, row.id) }, k, unb64(row.payload)));
          items.push({ id: row.id, kind: row.kind, label: row.label, hash: row.hash, updatedAt: row.updated_at, data });
        } catch { /* An entry that no longer decrypts is skipped; the owner can reconnect it. */ }
      }
      return json({ items });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "");
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return json({ error: "Invalid connection." }, 400);
    if (path === "/providers/delete") {
      await env.DB.prepare("DELETE FROM provider_links WHERE user_id=? AND id=?").bind(user.id, id).run();
      return json({ ok: true });
    }
    if (path === "/providers/put") {
      const kind = String(body.kind || ""), data = String(body.data || ""), label = String(body.label || "").slice(0, 200), hash = String(body.hash || "").slice(0, 128);
      if (!KINDS.has(kind)) return json({ error: "Unsupported provider." }, 400);
      if (!data || data.length > MAX_BYTES) return json({ error: "Invalid credentials." }, 400);
      try { JSON.parse(data); } catch { return json({ error: "Invalid credentials." }, 400); }
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_links WHERE user_id=? AND id<>?").bind(user.id, id).first();
      if ((count?.n || 0) >= MAX_ITEMS) return json({ error: "Remove a connected account before adding another." }, 400);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const payload = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bound(user.id, id) }, await key(env), new TextEncoder().encode(data));
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO provider_links(user_id,id,kind,label,hash,iv,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET kind=excluded.kind,label=excluded.label,hash=excluded.hash,iv=excluded.iv,payload=excluded.payload,updated_at=excluded.updated_at")
        .bind(user.id, id, kind, label, hash, b64(iv), b64(payload), now, now).run();
      return json({ ok: true, updatedAt: now });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error.message || "Account linking is unavailable." }, 500);
  }
}
