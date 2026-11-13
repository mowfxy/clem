// Incoming webhooks for routines (core/proactivity/routines.ts): POST /hook/<routine id>?key=<key> (or the key in an
// X-Clem-Key header) runs that routine with what was sent. It is the only thing this server does: no other path, no
// engine method, a 64 KB body cap and a per-address rate limit. The desktop serves it on 127.0.0.1 (local automations);
// the VPS worker on its own port, so services on the internet can reach it.
import { createServer, type Server } from "node:http";

export type HookTarget = (id: string, key: string, payload: unknown) => Promise<{ status: 202 | 404 | 429 }>;

export function serveHooks(o: { port: number; host: string; target: () => Promise<HookTarget | undefined>; log?: (m: string) => void }): Promise<Server> {
  const recent = new Map<string, number[]>();
  const server = createServer(async (req, res) => {
    const send = (status: number, body: object) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url || "/", "http://x");
      const m = /^\/hook\/(rt[\w-]{4,40})\/?$/.exec(url.pathname);
      if (!m || req.method !== "POST") return send(404, { error: "Not found" });
      const who = req.socket.remoteAddress || "?", now = Date.now(), hits = (recent.get(who) || []).filter((t) => now - t < 60_000);
      if (hits.length >= 30) return send(429, { error: "Too many requests" });
      recent.set(who, [...hits, now]);
      if (recent.size > 5000) recent.clear();
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of req) { size += (c as Buffer).length; if (size > 65_536) return send(413, { error: "Too large" }); chunks.push(c as Buffer); }
      const raw = Buffer.concat(chunks).toString("utf8");
      let payload: unknown = raw;
      if (/json/i.test(req.headers["content-type"] || "") || /^\s*[{[]/.test(raw)) try { payload = JSON.parse(raw); } catch { /* kept as text */ }
      const key = String(req.headers["x-clem-key"] || url.searchParams.get("key") || "");
      const target = await o.target();
      if (!target) return send(503, { error: "Clem isn't running here right now" });
      const r = await target(m[1], key, payload);
      send(r.status, r.status === 202 ? { ok: true } : { error: r.status === 429 ? "Too soon, try again in a few seconds" : "Not found" });
    } catch (e) { o.log?.("[hooks] " + (e as Error).message); send(400, { error: "Bad request" }); }
  });
  return new Promise((resolve, reject) => { server.on("error", reject); server.listen(o.port, o.host, () => resolve(server)); });
}
