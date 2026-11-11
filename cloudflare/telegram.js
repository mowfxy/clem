// Telegram (docs/DESKTOP.md "Telegram"): one Clem bot, through grammY, on the account Worker. The bot token
// (TELEGRAM_BOT_TOKEN) and the webhook secret (TELEGRAM_WEBHOOK_SECRET) are Worker secrets and never leave it.
// - POST /webhooks/telegram (Telegram, checked by its secret header): pairing codes, and what paired chats send, kept
//   sealed in telegram_inbox; anyone else is told politely that the bot only talks to paired Clem accounts.
// - /telegram/* (the person's Supabase sign-in): pair, unpair and status for the window; inbox, ack, send, typing and
//   file for their engine (desktop now, a VPS later), which answers with Clem's own agent.
import { Bot, InputFile } from "grammy";
import { CODE_TTL_MS, TG_FILE_LIMIT, TG_TEXT_LIMIT, TRIES_PER_MINUTE, canIssue, codeHash, deepLink, keyboardOk, newCode, readCode } from "../core/telegram/pairing.ts";
import { HttpError, json, limit, readJson } from "./lib/http.js";
import { key as vaultKey, open, seal } from "./provider-vault.js";

export const NOT_PAIRED = "Hi! I only talk to paired Clem accounts. To pair this chat, open Clem and send me the 6-digit code from your main thread (or Settings → Channels → Telegram).";
export const PAIRED = "Paired. This chat now talks to your Clem: ask anything, and your updates can come here too. Send /unpair to stop.";
export const BAD_CODE = "That code didn't work. Codes work once and last 10 minutes; ask Clem for a new one.";
export const OFFLINE = "Got it. Your Clem isn't online right now, so I'll answer as soon as it's back.";
/** How long an engine may go without pulling before a message is answered with OFFLINE (at most once an hour). */
const OFFLINE_AFTER = 120_000, LEASE_MS = 120_000;

const now = () => Date.now();
const secretOk = (a, b) => { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const configured = (env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_BOT_USERNAME);

/** The bot, with what it needs known up front (no getMe call). `client` lets tests hand grammY a fake Telegram API. */
export function botFor(env, client) {
  const id = Number(String(env.TELEGRAM_BOT_TOKEN).split(":")[0]) || 1;
  const botInfo = { id, is_bot: true, first_name: "Clem", username: env.TELEGRAM_BOT_USERNAME, can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };
  return new Bot(env.TELEGRAM_BOT_TOKEN, { botInfo, client });
}

const linkOfChat = (env, chatId) => env.DB.prepare("SELECT user_id,from_id,last_seen,offline_noted FROM telegram_links WHERE chat_id=?").bind(chatId).first();
const linkOf = (env, userId) => env.DB.prepare("SELECT chat_id,from_id,name,created_at,last_seen FROM telegram_links WHERE user_id=?").bind(userId).first();
const nameOf = (from) => (from?.username ? "@" + from.username : [from?.first_name, from?.last_name].filter(Boolean).join(" ")).slice(0, 80);

/** Keeps one thing a paired chat sent, once per Telegram update (a redelivered update changes nothing). */
async function keep(env, userId, id, kind, item) {
  await env.DB.prepare("INSERT OR IGNORE INTO telegram_inbox(user_id,id,kind,sealed,created_at) VALUES(?,?,?,?,?)").bind(userId, id, kind, await seal(env, userId, "tg-" + id, JSON.stringify(item)), now()).run();
}

/** What the bot does with one update from Telegram. Exported for tests. */
export function wire(bot, env) {
  bot.on("message", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const chatId = ctx.chat.id, text = String(ctx.message.text || "").trim();
    const link = await linkOfChat(env, chatId);
    const code = readCode(text);
    if (code) {
      if (!(await limit(env, "tgpair:" + chatId, TRIES_PER_MINUTE))) return void await ctx.reply("Too many tries. Wait a minute, then send the code again.");
      // Single use: the code is deleted as it is read, so a second message with it finds nothing.
      const row = await env.DB.prepare("DELETE FROM telegram_pairings WHERE hash=? AND expires_at>? RETURNING user_id").bind(await codeHash(code, env.TELEGRAM_WEBHOOK_SECRET), now()).first();
      if (!row) return void await ctx.reply(BAD_CODE);
      await env.DB.prepare("DELETE FROM telegram_links WHERE chat_id=? OR user_id=?").bind(chatId, row.user_id).run();
      await env.DB.prepare("INSERT INTO telegram_links(user_id,chat_id,from_id,name,created_at) VALUES(?,?,?,?,?)").bind(row.user_id, chatId, ctx.from.id, nameOf(ctx.from), now()).run();
      await env.DB.prepare("DELETE FROM telegram_pairings WHERE user_id=?").bind(row.user_id).run();
      return void await ctx.reply(PAIRED);
    }
    if (!link || link.from_id !== ctx.from?.id) return void await ctx.reply(NOT_PAIRED);
    if (/^\/unpair(@\w+)?$/.test(text)) {
      await unpair(env, link.user_id);
      return void await ctx.reply("Unpaired. Pair again from Clem whenever you like.");
    }
    if (/^\/(start|help)(@\w+)?$/.test(text)) return void await ctx.reply("You're paired with Clem. Just write to me here: questions, \"send me lecture 3 slides\", anything you'd ask in your main thread.");
    if (!text) return void await ctx.reply("I can read text messages here for now. Send files to Clem on your PC.");
    await keep(env, link.user_id, "m" + ctx.update.update_id, "message", { text: text.slice(0, 4000), messageId: ctx.message.message_id, at: ctx.message.date * 1000 });
    if (now() - link.last_seen > OFFLINE_AFTER && now() - link.offline_noted > 3600_000) {
      await env.DB.prepare("UPDATE telegram_links SET offline_noted=? WHERE user_id=?").bind(now(), link.user_id).run();
      await ctx.reply(OFFLINE);
    }
  });
  bot.on("callback_query:data", async (ctx) => {
    const chatId = ctx.callbackQuery.message?.chat.id, link = chatId ? await linkOfChat(env, chatId) : null;
    if (!link || link.from_id !== ctx.from.id || !/^b:[\w-]{1,40}$/.test(ctx.callbackQuery.data)) return void await ctx.answerCallbackQuery({ text: "This bot only talks to paired Clem accounts." });
    await keep(env, link.user_id, "t" + ctx.update.update_id, "tap", { data: ctx.callbackQuery.data, messageId: ctx.callbackQuery.message?.message_id, at: now() });
    await ctx.answerCallbackQuery({ text: now() - link.last_seen > OFFLINE_AFTER ? "Clem will do this when your PC is back online." : "On it…" });
  });
  return bot;
}

/** POST /webhooks/telegram. Always 200 once the secret matches, so Telegram doesn't resend a failed update forever. */
export async function telegramWebhook(request, env, client) {
  if (!configured(env)) return json({ error: "Not found" }, 404);
  if (!secretOk(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "", env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: "Forbidden" }, 403);
  const raw = await request.text();
  if (raw.length > 1_000_000) return json({ ok: true });
  let update;
  try { update = JSON.parse(raw); } catch { return json({ ok: true }); }
  try { await wire(botFor(env, client), env).handleUpdate(update); }
  catch (error) { console.error("Telegram update failed", error?.message); }
  return json({ ok: true });
}

async function unpair(env, userId) {
  const link = await linkOf(env, userId);
  await env.DB.prepare("DELETE FROM telegram_links WHERE user_id=?").bind(userId).run();
  await env.DB.prepare("DELETE FROM telegram_inbox WHERE user_id=?").bind(userId).run();
  await env.DB.prepare("DELETE FROM telegram_pairings WHERE user_id=?").bind(userId).run();
  return link;
}

/** Sends one message, falling back to plain text if Telegram can't read its HTML. */
async function sendText(api, chatId, html, buttons) {
  const markup = buttons?.length ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((k) => (k.url ? { text: k.text, url: k.url } : { text: k.text, callback_data: k.data }))) } } : {};
  try { return await api.sendMessage(chatId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup }); }
  catch (error) {
    if (!/parse entities|can't parse/i.test(String(error?.description || error?.message))) throw error;
    return api.sendMessage(chatId, html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"), markup);
  }
}

/** /telegram/*, for a signed-in person. undefined: not a Telegram path. `o.client`, `o.sleep`: tests. */
export async function handleTelegram(request, env, user, path, o = {}) {
  if (path !== "/telegram" && !path.startsWith("/telegram/")) return undefined;
  try {
    if (!configured(env)) return path === "/telegram" ? json({ configured: false, paired: null }) : json({ error: "Telegram isn't set up on Clem's server yet." }, 503);
    const t = now();
    if (path === "/telegram" && request.method === "GET") {
      const link = await linkOf(env, user.id);
      return json({ configured: true, bot: env.TELEGRAM_BOT_USERNAME, paired: link ? { name: link.name, since: link.created_at, online: t - link.last_seen < OFFLINE_AFTER } : null });
    }
    if (path === "/telegram/inbox" && request.method === "GET") {
      if (!(await linkOf(env, user.id))) return json({ paired: false, items: [] });
      const wait = Math.min(25, Math.max(0, Number(new URL(request.url).searchParams.get("wait")) || 0)) * 1000;
      const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
      for (const end = t + wait; ;) {
        await env.DB.prepare("UPDATE telegram_links SET last_seen=?,offline_noted=0 WHERE user_id=?").bind(now(), user.id).run();
        const { results } = await env.DB.prepare("SELECT id,kind,sealed,created_at FROM telegram_inbox WHERE user_id=? AND lease_until<? ORDER BY created_at,id LIMIT 20").bind(user.id, now()).all();
        if (results.length || now() >= end) {
          const k = await vaultKey(env), items = [];
          for (const r of results) {
            await env.DB.prepare("UPDATE telegram_inbox SET lease_until=? WHERE user_id=? AND id=?").bind(now() + LEASE_MS, user.id, r.id).run();
            try { items.push({ id: r.id, kind: r.kind, at: r.created_at, ...JSON.parse(await open(k, user.id, "tg-" + r.id, r.sealed)) }); }
            catch { await env.DB.prepare("DELETE FROM telegram_inbox WHERE user_id=? AND id=?").bind(user.id, r.id).run(); }
          }
          return json({ paired: true, items });
        }
        await sleep(2000);
      }
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (path === "/telegram/pair") {
      // Codes asked for this hour (a counter beside the other rate limits; the hourly cron clears old ones).
      const bucket = "tgcodes:" + user.id + ":" + Math.floor(t / 3600_000);
      const asked = (await env.DB.prepare("SELECT count FROM desktop_rate_limits WHERE key=?").bind(bucket).first())?.count || 0;
      if (!canIssue(asked)) return json({ error: "That's a lot of codes. Try again in a little while." }, 429);
      await env.DB.prepare("INSERT INTO desktop_rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1").bind(bucket, Math.floor(t / 60000) + 60).run();
      await env.DB.prepare("DELETE FROM telegram_pairings WHERE user_id=? OR expires_at<?").bind(user.id, t).run();
      for (let i = 0; i < 5; i++) {
        const code = newCode(o.random), expires = t + CODE_TTL_MS;
        const r = await env.DB.prepare("INSERT OR IGNORE INTO telegram_pairings(hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").bind(await codeHash(code, env.TELEGRAM_WEBHOOK_SECRET), user.id, t, expires).run();
        if (r.meta?.changes !== 0) return json({ code, link: deepLink(env.TELEGRAM_BOT_USERNAME, code), expires, bot: env.TELEGRAM_BOT_USERNAME });
      }
      return json({ error: "Couldn't make a code. Try again." }, 503);
    }
    if (path === "/telegram/unpair") {
      const link = await unpair(env, user.id);
      if (link) await botFor(env, o.client).api.sendMessage(link.chat_id, "Unpaired from Clem. Pair again from Clem whenever you like.").catch(() => {});
      return json({ ok: true });
    }
    const link = await linkOf(env, user.id);
    if (path === "/telegram/ack") {
      const body = await readJson(request, 20_000);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string" && /^[mt]\d{1,20}$/.test(x)).slice(0, 100) : [];
      for (const id of ids) await env.DB.prepare("DELETE FROM telegram_inbox WHERE user_id=? AND id=?").bind(user.id, id).run();
      return json({ ok: true, acked: ids.length });
    }
    if (!link) return json({ error: "Telegram isn't paired.", paired: false }, 409);
    const api = botFor(env, o.client).api;
    if (path === "/telegram/typing") { await api.sendChatAction(link.chat_id, "typing").catch(() => {}); return json({ ok: true }); }
    if (path === "/telegram/send") {
      const body = await readJson(request, 40_000);
      const html = String(body.html || "");
      if (!html.trim() || html.length > TG_TEXT_LIMIT) return json({ error: "Message is empty or too long." }, 400);
      if (body.buttons !== undefined && !keyboardOk(body.buttons)) return json({ error: "Invalid buttons." }, 400);
      const sent = await sendText(api, link.chat_id, html, body.buttons);
      return json({ ok: true, messageId: sent?.message_id });
    }
    if (path === "/telegram/file") {
      const size = Number(request.headers.get("Content-Length") || 0);
      if (size > TG_FILE_LIMIT + 64_000) return json({ error: "Telegram takes files up to 50 MB." }, 413);
      const form = await request.formData();
      const file = form.get("file"), caption = String(form.get("caption") || "").slice(0, 1000);
      if (!file || typeof file === "string") return json({ error: "No file." }, 400);
      if (file.size > TG_FILE_LIMIT) return json({ error: "Telegram takes files up to 50 MB." }, 413);
      const name = String(file.name || "file").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "file";
      const sent = await api.sendDocument(link.chat_id, new InputFile(new Uint8Array(await file.arrayBuffer()), name), caption ? { caption } : {});
      return json({ ok: true, messageId: sent?.message_id });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("Telegram request failed", error?.message);
    return json({ error: "Telegram is unavailable. Try again shortly." }, 502);
  }
}
