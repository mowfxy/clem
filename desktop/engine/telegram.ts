// Telegram's relay in the engine (docs/DESKTOP.md "Telegram"). Host-agnostic: the account service comes in through
// EngineHost.account (desktop: the signed-in person's Supabase token; a VPS: its own), answers through
// EngineHost.converse (desktop: the window's main thread, the same agent, tools and hand-off as typing there).
// It pulls what the paired chat sent from the Worker's inbox, answers it (typing while it works), sends CMS files, and
// is the notifier's Telegram channel: what Clem says by itself arrives as plain messages with no buttons, and the
// person steers it in words. Taps on buttons of older messages still run through the same appliers. No electron here.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TG_FILE_LIMIT } from "../../core/telegram/pairing.ts";
import { cardsIn } from "../../core/guc/cards.ts";
import { noticeMessage, plainMessage, replyMessages, type Button, type Tap, type TgMessage } from "../../core/telegram/render.ts";
import type { Db } from "./db.ts";
import type { EngineHost, TelegramTurn } from "./host.ts";
import type { Organizer } from "./organizer.ts";

export type TelegramStatus = { configured: boolean; bot?: string; paired: { name: string; since: number; online?: boolean } | null };
export type InboxItem = { id: string; kind: "message" | "tap"; text?: string; data?: string; at: number };
/** What the relay needs from the engine besides the organizer: a subject's check, a CMS file's bytes, names. */
export type RelayEngine = {
  checkNow(subjectId: string): Promise<{ saved?: number } | null>;
  file(materialId: string): Promise<{ name: string; type: string; size: number; path: string }>;
};
/** How long a Telegram question may take before the person is told Clem couldn't answer. */
export const ANSWER_MS = 10 * 60_000;
const TYPING_MS = 4500, STATUS_MS = 60_000;
const errorText = (e: unknown) => String((e as Error)?.message || e);

export class TelegramRelay {
  private db: Db; private owner: string; private host: EngineHost; private organizer: Organizer; private engine: RelayEngine; private clock: () => number;
  private cached?: { at: number; value: TelegramStatus };
  private stopped = true;
  private loop?: Promise<void>;
  private abort?: AbortController;
  /** Names of subjects and projects for cards (the window's workspace). */
  private names = new Map<string, string>();
  constructor(o: { db: Db; owner: string; host: EngineHost; organizer: Organizer; engine: RelayEngine; clock?: () => number }) {
    this.db = o.db; this.owner = o.owner; this.host = o.host; this.organizer = o.organizer; this.engine = o.engine; this.clock = o.clock || Date.now;
  }
  get available() { return !!this.host.account; }

  // ---------- The account service ----------
  private async call<T = any>(path: string, body?: unknown, o: { form?: FormData; timeout?: number; signal?: AbortSignal } = {}): Promise<T> {
    if (!this.host.account) throw Error("Telegram needs Clem's account service.");
    const init = o.form ? { method: "POST", body: o.form } : body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    const r = await this.host.account(path, init, o.signal, o.timeout ?? 20_000);
    const json = await r.json().catch(() => ({})) as any;
    if (!r.ok) { const e = Error(json.error || "Telegram is unavailable right now.") as Error & { status?: number; paired?: boolean }; e.status = r.status; e.paired = json.paired; throw e; }
    return json;
  }
  /** Pairing as the account last said (cached a minute; `fresh` asks now). */
  async status(fresh = false): Promise<TelegramStatus> {
    if (!this.host.account) return { configured: false, paired: null };
    if (!fresh && this.cached && this.clock() - this.cached.at < STATUS_MS) return this.cached.value;
    const value = await this.call<TelegramStatus>("/telegram");
    this.remember(value);
    return value;
  }
  private remember(value: TelegramStatus) {
    const was = this.cached?.value.paired;
    this.cached = { at: this.clock(), value };
    void (value.paired
      ? this.db.query("insert into telegram_link (owner_id, chat_id, name, checked_at) values ($1, 'paired', $2, now()) on conflict (owner_id) do update set name = excluded.name, checked_at = now()", [this.owner, value.paired.name])
      : this.db.query("delete from telegram_link where owner_id = $1", [this.owner])).catch(() => {});
    // Paired just now: the inbox is read at once.
    if (!was && value.paired) this.abort?.abort();
  }
  async paired() {
    try { return !!(await this.status()).paired; }
    catch { return (await this.db.query("select 1 from telegram_link where owner_id = $1", [this.owner])).length > 0; }
  }
  /** A new code (the window shows it with its countdown). */
  async pair() { const r = await this.call<{ code: string; link: string; expires: number; bot: string }>("/telegram/pair", {}); this.cached = undefined; return r; }
  async unpair() { await this.call("/telegram/unpair", {}); this.remember({ ...(this.cached?.value || { configured: true }), paired: null }); return this.status(true); }

  // ---------- The inbox ----------
  start() {
    if (!this.host.account || !this.stopped) return;
    this.stopped = false;
    this.loop = (async () => {
      let backoff = 15_000;
      while (!this.stopped) {
        try {
          if (!(await this.status(true)).paired) { await this.nap(60_000); continue; }
          await this.pullOnce(25);
          backoff = 15_000;
        } catch (e) {
          if ((e as { paired?: boolean }).paired === false) this.cached = undefined;
          else this.host.log("warn", "[telegram] " + errorText(e));
          await this.nap(backoff); backoff = Math.min(backoff * 2, 120_000);
        }
      }
    })();
  }
  async stop() { this.stopped = true; this.abort?.abort(); await this.loop?.catch(() => {}); }
  private nap(ms: number) {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    return new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }); });
  }
  /** One pull: everything waiting is handled (each once, ever) and acknowledged. */
  async pullOnce(wait = 0) {
    this.abort = new AbortController();
    const { items, paired } = await this.call<{ items: InboxItem[]; paired: boolean }>(`/telegram/inbox?wait=${wait}`, undefined, { timeout: (wait + 15) * 1000, signal: this.abort.signal });
    if (!paired) { this.cached = undefined; return 0; }
    for (const item of items) {
      const fresh = await this.db.query("insert into telegram_seen (owner_id, id) values ($1, $2) on conflict do nothing returning 1", [this.owner, item.id]);
      if (fresh.length) await this.handle(item).catch((e) => this.host.log("warn", "[telegram] " + errorText(e)));
    }
    if (items.length) await this.call("/telegram/ack", { ids: items.map((i) => i.id) });
    await this.db.query("delete from telegram_seen where owner_id = $1 and seen_at < now() - interval '14 days'", [this.owner]);
    return items.length;
  }
  private async handle(item: InboxItem) {
    if (item.kind === "tap") {
      const token = /^b:([\w-]{1,40})$/.exec(item.data || "")?.[1];
      const [row] = token ? await this.db.query<{ tap: Tap }>("select tap from telegram_buttons where owner_id = $1 and token = $2", [this.owner, token]) : [];
      if (!row) return this.say("That button is from an older message. Ask me again and I'll do it.");
      return this.tap(item.id, row.tap);
    }
    if (item.text) return this.answer({ id: item.id, text: item.text });
  }
  /** Clem's answer to a message (or a tap that needs the agent), with "typing…" shown until it comes. */
  private async answer(turn: TelegramTurn) {
    if (!this.host.converse) return this.say("Clem can't answer here right now. Open Clem on your PC and try again.");
    let done = false, wake = () => {};
    const typing = (async () => { while (!done) { await this.call("/telegram/typing", {}).catch(() => {}); if (!done) await new Promise<void>((r) => { wake = r; const t = setTimeout(r, TYPING_MS); t.unref?.(); }); } })();
    try {
      const reply = await Promise.race([this.host.converse(turn), new Promise<never>((_, no) => { const t = setTimeout(() => no(Error("timeout")), ANSWER_MS); t.unref?.(); })]);
      done = true;
      await this.reply(reply.text || "Done.");
      for (const f of reply.files || []) await this.upload(f.name, f.type, f.bytes);
    } catch (e) {
      done = true;
      this.host.log("warn", "[telegram] answer: " + errorText(e));
      await this.say(errorText(e) === "timeout" ? "This is taking longer than it should. You'll find the answer in Clem's main thread." : "Clem couldn't answer that just now. Try again in a moment.");
    } finally { done = true; wake(); await typing; }
  }
  /** A tap: the organizer's own buttons run here; the ones that change the workspace or need the agent go to the
   *  window (desktop/main.ts → the same appliers as its buttons). */
  private async tap(id: string, tap: Tap) {
    const o = this.organizer;
    switch (tap.t) {
      case "dismiss": await o.dismiss(tap.key); this.host.changed?.(); return this.say("Skipped.");
      case "mute": await o.mute(tap.key); this.host.changed?.(); return this.say("Got it. I won't tell you about this kind of thing.");
      case "stop": await o.stopWatch(tap.id); this.host.changed?.(); return this.say("Stopped watching.");
      case "check": {
        const r = await this.engine.checkNow(tap.subjectId).catch((e) => { throw Error(errorText(e)); });
        return this.say(r?.saved ? `Checked. Saved ${r.saved} new file${r.saved === 1 ? "" : "s"}.` : "Checked. Nothing new.");
      }
      case "send": return void await this.sendFile(tap.fileId);
      case "open": this.host.open?.({ route: tap.route, chat: tap.chat, message: tap.message }); return this.say(this.host.open ? "Opened in Clem on your PC." : "Open Clem on your PC to see it.");
      default: return this.answer({ id, tap });
    }
  }

  // ---------- Sending ----------
  private async token(tap: Tap) {
    const token = randomBytes(9).toString("base64url");
    await this.db.query("insert into telegram_buttons (owner_id, token, tap) values ($1, $2, $3)", [this.owner, token, tap]);
    return token;
  }
  async send(messages: TgMessage[]) {
    if (messages.length) await this.db.query("delete from telegram_buttons where owner_id = $1 and created_at < now() - interval '30 days'", [this.owner]);
    for (const m of messages) {
      const buttons = await Promise.all(m.buttons.slice(0, 12).map((row) => Promise.all(row.slice(0, 4).map(async (b: Button) => ({ text: b.text.slice(0, 64), data: "b:" + await this.token(b.tap) })))));
      await this.call("/telegram/send", { html: m.html, ...(buttons.length ? { buttons } : {}) });
    }
  }
  say(text: string) { return this.send([{ html: text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), buttons: [] }]); }
  /** Names for cards, from the workspace the host sees. */
  private async context() {
    const ws = await this.host.workspace?.().catch(() => null) as { spaces?: { id: string; name: string }[] } | null;
    for (const s of ws?.spaces || []) this.names.set(s.id, s.name);
    return this.names;
  }
  /** Clem's answer (Markdown with clem-cards): its text, then each card (organizer cards as text, without buttons). */
  async reply(content: string) {
    const names = await this.context();
    await this.send(replyMessages(content, { name: (id) => (id ? names.get(id) : undefined) }));
  }
  /** The notifier's Telegram channel. What Clem says by itself is a plain message, as in the app: its words, no
   *  buttons (the person answers in words). Only the password notice, a security flow, keeps its card. */
  async deliver(n: { title: string; body: string; cards?: string; open?: { route?: string; chat?: string; message?: string } }) {
    if (n.cards && cardsIn(n.cards).some((c) => c.type === "guc_password")) return this.reply(n.cards);
    return this.send([plainMessage(n.title === "Clem" || !n.title ? n.body : `${n.title}: ${n.body}`)]);
  }
  private async upload(name: string, type: string, bytes: Uint8Array, caption?: string) {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)], { type: type || "application/octet-stream" }), name);
    if (caption) form.set("caption", caption);
    await this.call("/telegram/file", undefined, { form, timeout: 180_000 });
  }
  /** A CMS file to the paired chat (the AI's telegram.sendFile, or Send me the file). Telegram takes 50 MB; a bigger file
   *  gets a short note and Open in Clem instead. */
  async sendFile(materialId: string): Promise<{ sent: boolean; name: string; size: number; reason?: string }> {
    if (!(await this.paired())) throw Error("Telegram isn't paired. The person can pair it from their main thread or Settings → Channels → Telegram.");
    const f = await this.engine.file(materialId);
    if (f.size > TG_FILE_LIMIT) {
      await this.send([noticeMessage(f.name, `This file is ${Math.round(f.size / 1048576)} MB, more than Telegram's 50 MB, so it can't come here. It's in Clem on your PC.`, [[{ text: "Open in Clem", tap: { t: "open", route: "#/app/guc/cms" } }]])]);
      return { sent: false, name: f.name, size: f.size, reason: "Bigger than Telegram's 50 MB: the person was told and offered Open in Clem." };
    }
    await this.upload(f.name, f.type, new Uint8Array(await readFile(f.path)), f.name);
    return { sent: true, name: f.name, size: f.size };
  }
}
