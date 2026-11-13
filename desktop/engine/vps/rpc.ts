// The worker's small HTTP endpoint and the desktop's client for it (docs/GUC-VPS-ENGINE.md "Background worker"). It
// listens on 127.0.0.1 only; the desktop reaches it through the SSH tunnel (VpsLink.tunnel), never a public port, and
// every request carries the RPC token (sent to the worker sealed, at install).
import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Lease } from "../../../core/vps/lease.ts";

/** Engine methods the desktop may call on the worker's engine: what the window's requests use. */
export const RPC_METHODS = new Set([
  "status", "connect", "updatePassword", "sync", "disconnect", "overview", "courses", "schedule", "announcements", "markRead", "materials", "search", "grades", "deadlines", "term", "mail",
  "links", "subject", "link", "unlink", "setSettings", "checkNow", "inbox", "ackInbox", "forgetSubject", "newCourses", "ackNewCourses", "now", "fileText", "fileBytes", "mailMessage", "saveFile",
  "organizer.settings", "organizer.setSettings", "organizer.inbox", "organizer.ack", "organizer.log", "organizer.statuses", "organizer.undo", "organizer.confirm", "organizer.dismiss",
  "organizer.mute", "organizer.unmute", "organizer.mutesList", "organizer.poke", "organizer.watches", "organizer.stopWatch", "organizer.offerTelegram", "organizer.watch", "organizer.reminders", "organizer.cancelReminder",
  "organizer.tool", "organizer.routines", "organizer.stopRoutine", "organizer.runRoutine", "organizer.hook",
  "telegram.status", "telegram.pair", "telegram.unpair",
]);

/** Calls `path` ("organizer.inbox") on `target` with JSON args; only RPC_METHODS. */
export async function callPath(target: object, path: string, args: unknown[]) {
  if (!RPC_METHODS.has(path)) throw Error("Not allowed: " + path);
  const parts = path.split("."), name = parts.pop()!;
  const owner = parts.reduce((o: any, k) => o?.[k], target);
  if (typeof owner?.[name] !== "function") throw Error("No such method: " + path);
  return owner[name](...args);
}

export type WorkerHandlers = {
  call(path: string, args: unknown[]): Promise<unknown>;
  workspace(snapshot: unknown): Promise<void>;
  lease(who: "desktop"): Promise<{ lease: Lease; run: boolean }>;
  health(): Promise<Record<string, unknown>>;
  notices(): unknown[];
};

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function serveWorker(o: { token: string; port: number; host?: string; handlers: WorkerHandlers; log?: (m: string) => void }): Promise<Server> {
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (!same(req.headers.authorization || "", "Bearer " + o.token)) return send(401, { error: "Not allowed" });
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of req) { size += (c as Buffer).length; if (size > 30_000_000) return send(413, { error: "Too large" }); chunks.push(c as Buffer); }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const url = new URL(req.url || "/", "http://x");
      if (url.pathname === "/health" && req.method === "GET") return send(200, await o.handlers.health());
      if (url.pathname === "/rpc" && req.method === "POST") return send(200, { result: (await o.handlers.call(String(body.path), Array.isArray(body.args) ? body.args : [])) ?? null });
      if (url.pathname === "/workspace" && req.method === "PUT") { await o.handlers.workspace(body); return send(200, { ok: true }); }
      if (url.pathname === "/lease" && req.method === "POST") return send(200, await o.handlers.lease("desktop"));
      if (url.pathname === "/notices" && req.method === "GET") return send(200, o.handlers.notices());
      send(404, { error: "Not found" });
    } catch (e) {
      o.log?.("[worker] request failed: " + (e as Error).message);
      send(400, { error: (e as Error).message });
    }
  });
  return new Promise((resolve, reject) => { server.on("error", reject); server.listen(o.port, o.host || "127.0.0.1", () => resolve(server)); });
}

/** The desktop's side: everything goes to http://127.0.0.1:<tunnel port>. */
export class WorkerClient {
  private base: string; private token: string; private fetcher: typeof fetch;
  constructor(base: string, token: string, fetcher: typeof fetch = fetch) { this.base = base; this.token = token; this.fetcher = fetcher; }
  private async req<T>(path: string, init: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T> {
    const r = await this.fetcher(this.base + path, { method: init.method || "GET", headers: { authorization: "Bearer " + this.token, "content-type": "application/json" }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}), signal: AbortSignal.timeout(init.timeout ?? 60_000) });
    const json = await r.json().catch(() => ({})) as { error?: string };
    if (!r.ok) throw Error(json.error || "The worker didn't answer.");
    return json as T;
  }
  async call<T = unknown>(path: string, args: unknown[] = []) { return (await this.req<{ result: T }>("/rpc", { method: "POST", body: { path, args: JSON.parse(JSON.stringify(args, (_k, v) => (typeof v === "function" ? undefined : v))) }, timeout: 180_000 })).result; }
  health() { return this.req<Record<string, unknown>>("/health", { timeout: 10_000 }); }
  lease() { return this.req<{ lease: Lease; run: boolean }>("/lease", { method: "POST", body: {}, timeout: 10_000 }); }
  pushWorkspace(snapshot: unknown) { return this.req("/workspace", { method: "PUT", body: snapshot }); }
  notices() { return this.req<{ key: string; title: string; body: string; open?: object }[]>("/notices"); }
}
