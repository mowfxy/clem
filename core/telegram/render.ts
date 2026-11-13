// Clem's replies and cards as Telegram messages (docs/DESKTOP.md "Telegram"): Telegram HTML (escaped), at most 4096
// characters each, with tap buttons. A button's tap is stored by the engine under a short token (desktop/engine/
// telegram.ts), so Telegram carries only "b:<token>" and the tap comes back through the inbox to the same appliers.
import { cardsIn, readCard, type ClemCard } from "../guc/cards.ts";
import { hubPath } from "../guc/hub.ts";
import { PASSWORD_NOTICE, PASSWORD_ROUTE } from "../guc/password.ts";
import { TG_TEXT_LIMIT } from "./pairing.ts";

/** What a button does once tapped in Telegram. `open` shows the route or chat in Clem on the person's PC. */
export type Tap =
  | { t: "undo" | "confirm" | "dismiss" | "mute"; key: string }
  | { t: "stop"; id: string }
  | { t: "summarize" | "flashcards"; subjectId: string; fileId: string; name: string }
  | { t: "check"; subjectId: string }
  | { t: "send"; fileId: string }
  | { t: "open"; route?: string; chat?: string; message?: string };
export type Button = { text: string; tap: Tap };
export type TgMessage = { html: string; buttons: Button[][] };
export type RenderContext = {
  /** A subject's or project's name. */
  name?: (spaceId?: string) => string | undefined;
  /** An organizer line's live status (apply, applied, confirm, said…), so only real Undo and Do it are offered. */
  status?: (key: string) => string | undefined;
};

/** Text made safe for Telegram's HTML: only &, < and > (and " in attributes) are special. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => esc(s).replace(/"/g, "&quot;");
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const label = (s: string) => cut(s.replace(/\s+/g, " ").trim(), 40);

/** Inline Markdown (what Clem's answers use) as Telegram HTML; everything else is escaped text. */
function inline(s: string) {
  const parts: string[] = [];
  // Code spans first: nothing inside them is formatted.
  for (const [i, piece] of s.split(/(`[^`\n]+`)/).entries()) {
    if (i % 2) { parts.push(`<code>${esc(piece.slice(1, -1))}</code>`); continue; }
    let t = esc(piece);
    t = t.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g, (_m, text, url) => `<a href="${attr(url.replace(/&amp;/g, "&"))}">${text}</a>`);
    // Links inside Clem (#/app/…) mean nothing in Telegram: their text stays.
    t = t.replace(/\[([^\]\n]{1,200})\]\(#[^\s)]{0,300}\)/g, "$1");
    t = t.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/__([^_\n]+)__/g, "<b>$1</b>");
    t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>").replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
    t = t.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    parts.push(t);
  }
  return parts.join("");
}
/** One block of Markdown (no clem-cards) as Telegram HTML: headings bold, lists with bullets, code fences as <pre>. */
export function markdownHtml(md: string) {
  const out: string[] = [];
  for (const [i, piece] of md.split(/```[^\n]*\n([\s\S]*?)```/).entries()) {
    if (i % 2) { out.push(`<pre>${esc(piece.replace(/\n$/, ""))}</pre>`); continue; }
    out.push(piece.split("\n").map((line) => {
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) return `<b>${inline(h[1])}</b>`;
      const li = /^(\s*)[-*+]\s+(.*)$/.exec(line);
      if (li) return `${li[1]}• ${inline(li[2])}`;
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return "";
      if (/^\s*\|.*\|\s*$/.test(line)) return /^\s*\|[\s:|-]+\|\s*$/.test(line) ? "" : esc(line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join(" · "));
      return inline(line.replace(/^>\s?/, ""));
    }).join("\n"));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const open = (route?: string): Button => ({ text: "Open in Clem", tap: route ? { t: "open", route } : { t: "open", chat: "main" } });
const lines = (xs: string[]) => xs.filter(Boolean).join("\n");

/** One card as a compact Telegram message; null for a card that means nothing outside Clem's window. */
export function cardMessage(card: ClemCard, c: RenderContext = {}): TgMessage | null {
  const name = (id?: string) => (id ? c.name?.(id) : undefined);
  switch (card.type) {
    case "brief":
      return { html: lines([`<b>${esc(card.title)}</b>`, ...card.items.map((i) => `• ${i.time ? esc(i.time) + " " : ""}${esc(i.text)}${i.space ? ` <i>(${esc(i.space)})</i>` : ""}`)]), buttons: [[open()]] };
    case "organizer": {
      const buttons: Button[][] = [];
      for (const l of card.lines) {
        if (!l.key || buttons.length >= 6) continue;
        const s = c.status?.(l.key);
        if (s === "apply" || s === "applied") buttons.push([{ text: `Undo: ${label(l.text)}`, tap: { t: "undo", key: l.key } }]);
        else if (s === "confirm") buttons.push([{ text: `Do it: ${label(l.text)}`, tap: { t: "confirm", key: l.key } }, { text: "Not now", tap: { t: "dismiss", key: l.key } }]);
        else if (s === "said" && l.key.startsWith("change:")) buttons.push([{ text: `Mute: ${label(l.text)}`, tap: { t: "mute", key: l.key } }]);
      }
      const first = card.lines.find((l) => l.href)?.href;
      return { html: lines([`<b>${esc(card.title)}</b>`, ...card.lines.map((l) => `• ${l.time ? esc(l.time) + " " : ""}${esc(l.text)}${l.space ? ` <i>(${esc(l.space)})</i>` : ""}`)]), buttons: [...buttons, [open(first)]] };
    }
    case "reminder":
      return { html: lines([`<b>Reminder:</b> ${esc(card.title)}`, card.space ? `<i>${esc(card.space)}</i>` : "", card.note ? esc(card.note) : ""]), buttons: [[open(card.spaceId ? `#/app/space/${encodeURIComponent(card.spaceId)}` : "#" + hubPath("deadlines"))]] };
    case "digest":
      return { html: lines([`<b>${esc(card.title || "Also new")}</b>`, ...card.lines.map((l) => `• ${esc(l.text)}${l.space ? ` <i>(${esc(l.space)})</i>` : ""}`)]), buttons: [] };
    case "watch":
      return { html: lines([`<b>Watching for you</b>`, esc(card.text), card.detail ? `<i>${esc(card.detail)}</i>` : ""]), buttons: [[{ text: "Stop watching", tap: { t: "stop", id: card.id } }]] };
    case "routine":
      return { html: lines([`<b>${esc(card.title)}</b>`, esc(card.when), card.does ? `<i>${esc(card.does)}</i>` : ""]), buttons: [] };
    case "lecture": {
      const where = name(card.subjectId);
      const n = card.files.length;
      return {
        html: lines([`<b>${n === 1 ? "New lecture" : `${n} new lectures`}${where ? " in " + esc(where) : ""}</b>`, ...card.files.map((f) => `• ${esc(f.name)}`)]),
        buttons: card.files.slice(0, 4).map((f) => [{ text: n === 1 ? "Summarize" : `Summarize ${label(f.name)}`, tap: { t: "summarize" as const, subjectId: card.subjectId, fileId: f.id, name: f.name } }, { text: "Make flashcards", tap: { t: "flashcards" as const, subjectId: card.subjectId, fileId: f.id, name: f.name } }]),
      };
    }
    case "file_saved": {
      const where = name(card.subjectId), n = card.files.length + (card.more || 0);
      const f = card.files[0];
      return {
        html: lines([`<b>Saved ${n === 1 ? "a file" : n + " files"}${where ? " in " + esc(where) : ""}</b>`, ...card.files.slice(0, 8).map((x) => `• ${esc(x.name)}${x.week ? ` <i>(${esc(x.week)})</i>` : ""}`), card.files.length > 8 || card.more ? `…and ${n - Math.min(8, card.files.length)} more` : ""]),
        buttons: [[{ text: "Summarize", tap: { t: "summarize", subjectId: card.subjectId, fileId: f.id, name: f.name } }, { text: "Send me the file", tap: { t: "send", fileId: f.id } }], [{ text: "Check now", tap: { t: "check", subjectId: card.subjectId } }]],
      };
    }
    case "announcement":
      return { html: lines([`<b>${esc(card.title)}</b>`, card.detail ? esc(cut(card.detail, 1500)) : ""]), buttons: [[open("#" + hubPath("announcements", card.id))]] };
    case "grade":
      return { html: lines([`<b>${esc(card.title)}</b>`, card.detail ? esc(cut(card.detail, 800)) : ""]), buttons: [[open("#" + hubPath("grades"))]] };
    case "deadline":
      return { html: lines([`<b>${card.changed ? "Deadline moved" : "New deadline"}:</b> ${esc(card.title)}`, card.detail ? esc(cut(card.detail, 800)) : ""]), buttons: [[open("#" + hubPath("deadlines", card.id))]] };
    case "handoff":
      return { html: `Continued in <b>${esc(card.spaceName)}</b>${card.title ? `: ${esc(card.title)}` : ""}.`, buttons: [[{ text: "Open in Clem", tap: { t: "open", chat: card.chatId } }]] };
    case "new_courses":
      return { html: lines([`<b>New courses on the CMS</b>`, ...card.courses.map((x) => `• ${esc(x.code)} ${esc(x.name)}`), "Link them to subjects in Clem."]), buttons: [[open("#" + hubPath("cms"))]] };
    case "settings_update": {
      const what = [card.saveText || (card.save || card.rules ? "what Clem saves" : ""), card.checkText || (card.check ? "when Clem checks" : ""), card.drive ? `Drive copy ${card.drive.enabled ? "on" : "off"}` : ""].filter(Boolean);
      return { html: `<b>Settings changed${name(card.subjectId) ? " for " + esc(name(card.subjectId)!) : ""}</b>${what.length ? "\n" + esc(what.join(" · ")) : ""}`, buttons: card.subjectId ? [[{ text: "Check now", tap: { t: "check", subjectId: card.subjectId } }]] : [] };
    }
    case "course_link": case "save_rules": case "check_schedule": case "drive_folder": case "storage": case "setup_done": {
      const where = name(card.subjectId);
      return { html: `<b>${where ? esc(where) + ": " : ""}subject settings</b>\nThese are set in Clem.`, buttons: [[{ text: "Check now", tap: { t: "check", subjectId: card.subjectId } }, open(`#/app/space/${encodeURIComponent(card.subjectId)}`)]] };
    }
    case "telegram_pair":
      return null;
    case "guc_password":
      return { html: `<b>${esc(PASSWORD_NOTICE.title)}</b>
${esc(PASSWORD_NOTICE.body)}`, buttons: [[{ text: "Update password", tap: { t: "open", route: "#" + PASSWORD_ROUTE } }]] };
    case "vps_moved":
      return { html: `<b>${card.direction === "up" ? "Your files are on your VPS" : "Your files are back on this device"}</b>\n${card.files} file${card.files === 1 ? "" : "s"} moved${card.failed ? `; ${card.failed} stayed where they were` : ""}.`, buttons: [[open("#/app/connectors/vps")]] };
    case "vps_confirm":
      return null;
  }
}

const CHUNK = TG_TEXT_LIMIT - 200;
/** Text split at paragraph (else line, else hard) boundaries before it is converted, so no tag is cut in two. */
function chunks(md: string) {
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const para of md.split(/\n{2,}/)) {
    for (const piece of para.length > CHUNK ? para.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, "g"))! : [para]) {
      if ((cur + "\n\n" + piece).length > CHUNK) push();
      cur = cur ? cur + "\n\n" + piece : piece;
    }
  }
  push();
  return out;
}
/** A whole answer (Markdown with clem-card blocks) as Telegram messages: its text in order, then each card. */
export function replyMessages(content: string, c: RenderContext = {}): TgMessage[] {
  const out: TgMessage[] = [];
  const text = content.replace(/```clem-card\n[\s\S]*?\n```/g, "").replace(/```(?:plan|memory|settings_update)\n[\s\S]*?\n```/g, "").trim();
  for (const part of chunks(text)) { const html = markdownHtml(part); if (html) out.push({ html: html.length > TG_TEXT_LIMIT ? esc(cut(part, CHUNK)) : html, buttons: [] }); }
  for (const card of cardsIn(content)) { const m = cardMessage(card, c); if (m) out.push(m); }
  return out;
}
/** A single card from its JSON body (what the notifier hands over). */
export const cardJson = (body: string, c: RenderContext = {}) => { const card = readCard(body); return card ? cardMessage(card, c) : null; };
/** A notification without a card: its title and body. */
export const noticeMessage = (title: string, body: string, buttons: Button[][] = []): TgMessage => ({ html: `<b>${esc(cut(title, 200))}</b>${body ? "\n" + esc(cut(body, 1500)) : ""}`, buttons });
