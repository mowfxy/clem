// Telegram without the network, for tests and scripts/verify/telegram.mjs: D1 on in-memory SQLite, a fake Telegram Bot
// API that logs every call, the account Worker's Telegram routes and webhook, and an engine host's `account` over them.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error plain JavaScript worker module
import { handleTelegram, telegramWebhook } from "../cloudflare/telegram.js";

const root = new URL("../", import.meta.url);
/** D1 over in-memory SQLite (as tests/account-worker.test.ts). */
export function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of ["cloudflare/account-schema.sql", "cloudflare/provider-links.sql", "cloudflare/telegram-schema.sql"]) db.exec(fs.readFileSync(new URL(f, root), "utf8"));
  return {
    db,
    prepare(sql: string) {
      let args: any[] = [];
      const st = {
        bind(...v: any[]) { args = v; return st; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      };
      return st;
    },
  };
}
/** A fake Telegram Bot API: every call is logged; nothing leaves the machine. */
export function fakeTelegram() {
  const calls: { method: string; body: any }[] = [];
  let n = 100;
  const fetch = async (url: string | URL, init?: any) => {
    const method = String(url).split("/").pop()!;
    let body: any = {};
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else if (init?.body) { const chunks: Buffer[] = []; for await (const c of init.body) chunks.push(Buffer.from(c)); body = { multipart: Buffer.concat(chunks).toString("latin1") }; }
    calls.push({ method, body });
    if (method === "sendMessage" && /<broken/.test(body.text || "") && body.parse_mode) return Response.json({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, { status: 400 });
    return Response.json({ ok: true, result: method === "sendChatAction" || method === "answerCallbackQuery" ? true : { message_id: n++, date: 0, chat: { id: 1, type: "private" } } });
  };
  return { calls, client: { fetch: fetch as any }, said: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.body) };
}
export const workerEnv = (o: Record<string, unknown> = {}) => ({ DB: d1(), TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_WEBHOOK_SECRET: "s".repeat(40), TELEGRAM_BOT_USERNAME: "ClemBot", PROVIDER_VAULT_KEY: Buffer.alloc(32, 9).toString("base64"), ...o });
export type WorkerEnv = ReturnType<typeof workerEnv>;
export type FakeTelegram = ReturnType<typeof fakeTelegram>;

let update = 1;
export const msg = (chat: number, text: string, from = chat) => ({ update_id: update++, message: { message_id: update, date: 1, chat: { id: chat, type: "private" }, from: { id: from, is_bot: false, first_name: "Sara", username: "sara" }, text } });
export const tap = (chat: number, data: string, from = chat) => ({ update_id: update++, callback_query: { id: "cq" + update, chat_instance: "x", from: { id: from, is_bot: false, first_name: "Sara" }, data, message: { message_id: 7, date: 1, chat: { id: chat, type: "private" } } } });
/** Telegram delivering an update to the webhook. */
export const hook = (env: WorkerEnv, tg: FakeTelegram, body: unknown, secret = env.TELEGRAM_WEBHOOK_SECRET): Promise<Response> => telegramWebhook(new Request("https://w/webhooks/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": String(secret) }, body: JSON.stringify(body) }), env, tg.client);
/** A signed-in person's request to /telegram/*. */
export const call = (env: WorkerEnv, tg: FakeTelegram, user: string, path: string, body?: unknown, query = "") => handleTelegram(new Request("https://w" + path + query, body === undefined ? {} : { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) }), env, { id: user }, path, { client: tg.client, sleep: async () => {} }).then((r: Response) => r.json());
/** EngineHost.account over the Worker's routes, as `user`. */
export const account = (env: WorkerEnv, tg: FakeTelegram, user: string) => async (path: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}) => {
  const url = new URL("https://w" + path);
  return handleTelegram(new Request(url, { method: init.method || "GET", headers: init.headers, body: init.body }), env, { id: user }, url.pathname, { client: tg.client, sleep: async () => {} }) as Promise<Response>;
};
