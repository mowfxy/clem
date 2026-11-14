// GUC mail for the sync: the Inbox's message list over EWS, read-only (core/guc/ews.ts builds only
// GetFolder/FindItem/GetItem, plus marking a message read when the person opens it in the hub). Change detection is the set of ids, not unread flags or dates, so a late delivery is
// still caught. The first read is a baseline: what is already there is not news (but it is previewed, so the hub
// shows what each message says).
import { asMail, BODY_BATCH, COURSE_TEXT, EWS_AUTH, EWS_URL, EwsError, findInbox, FULL, getBodies, mailId, markReadRequest, parseBodies, parseFind, parseUpdate, PREVIEW, type EwsItem } from "../../core/guc/ews.ts";
import type { GucMail } from "../../core/guc/types.ts";
import { GucError } from "./errors.ts";
import type { GucClient } from "./guc-client.ts";

/** Messages kept for the hub (newest), and seen ids kept for change detection. */
export const KEEP_MAIL = 60, KEEP_SEEN = 5000;

async function call(client: GucClient, request: { headers: Record<string, string>; body: string }) {
  const res = await client.send({ method: "POST", url: EWS_URL, headers: request.headers, body: request.body, noRedirect: true });
  if (res.status !== 200 && !/<(\w+:)?Envelope/.test(res.body)) throw new GucError("unavailable", "ews http " + res.status);
  return res.body;
}
const ewsFailure = (e: unknown) => e instanceof EwsError ? (EWS_AUTH.has(e.code) ? new GucError("auth", e.code) : new GucError("unavailable", e.code)) : e;

/** The Inbox, newest first, 100 a page. `known`: stop after a page holding only ids already seen (a pulse costs one
 *  request); `find`: stop at the page holding that message; neither: every page (the first read, and once a day). A
 *  server that won't list who a message was written to is asked again without it (the messages then count as sent to
 *  everyone unless they name a course). */
async function inbox(client: GucClient, o: { known?: Set<string>; find?: string } = {}) {
  const all: EwsItem[] = [];
  let to = true;
  for (let offset = 0, pages = 0; pages < 60; pages++) {
    let page: ReturnType<typeof parseFind>;
    try { page = parseFind(await call(client, findInbox(offset, to))); }
    catch (e) { if (!to || !(e instanceof EwsError) || EWS_AUTH.has(e.code)) throw e; to = false; page = parseFind(await call(client, findInbox(offset, false))); }
    all.push(...page.items);
    if (page.last || !page.items.length) break;
    if (o.find && page.items.some((i) => mailId(i.itemId) === o.find)) break;
    if (o.known && page.items.every((i) => o.known!.has(mailId(i.itemId)))) break;
    offset = Number.isFinite(page.next) && page.next > offset ? page.next : offset + page.items.length;
  }
  return all;
}

/** The Inbox now: the newest messages, previews for the ones not in `seen`, and previews for kept messages that have
 *  none yet (the baseline's, once). `seen` undefined is the first read: nothing in it is new. `full`: list every page
 *  (else it stops at the first page of messages already seen). `bodies`: the first COURSE_TEXT characters of each
 *  previewed message, for the sync to keep for course mail only. */
export async function readMail(client: GucClient, seen: string[] | undefined, previous: GucMail[] = [], o: { full?: boolean } = {}) {
  try {
    const known = new Set(seen || []);
    const all = await inbox(client, seen && !o.full ? { known } : {});
    const fresh = seen ? all.filter((i) => !known.has(mailId(i.itemId))) : [];
    const kept = new Map(previous.map((m) => [m.id, m]));
    const newest = [...all].sort((a, b) => b.received.localeCompare(a.received)).slice(0, KEEP_MAIL);
    // A kept message already previewed (even an empty one) is not asked for again.
    const backfill = newest.filter((i) => { const was = kept.get(mailId(i.itemId)); return !was || (!was.preview && !was.previewed); });
    const need = [...new Map([...fresh, ...backfill].map((i) => [i.itemId, i])).values()];
    const mustHave = new Set(fresh.map((i) => i.itemId));
    const bodies = new Map<string, string>();
    for (let i = 0; i < need.length; i += BODY_BATCH) {
      const batch = need.slice(i, i + BODY_BATCH).map((m) => m.itemId);
      const got = parseBodies(await call(client, getBodies(batch)), COURSE_TEXT);
      // A new message's body missing from the answer: the whole read is retried next time, nothing is marked seen.
      if (batch.some((id) => mustHave.has(id) && !got.has(id))) throw new GucError("unavailable", "incomplete_message_bodies");
      for (const [k, v] of got) bodies.set(k, v);
    }
    const preview = (id: string) => { const b = bodies.get(id); return b === undefined ? undefined : b.replace(/\s+/g, " ").trim().slice(0, PREVIEW); };
    const mail: GucMail[] = newest.map((i) => {
      const was = kept.get(mailId(i.itemId)), got = preview(i.itemId);
      return { ...asMail(i, got ?? was?.preview ?? ""), ...(got !== undefined || was?.previewed ? { previewed: true } : {}), ...(was?.text ? { text: was.text } : {}) };
    });
    const ids = all.map((i) => mailId(i.itemId));
    return { mail, seen: [...new Set([...(seen || []), ...ids])].slice(-KEEP_SEEN), fresh: fresh.map((i) => asMail(i, preview(i.itemId) || "")), bodies: new Map([...bodies].map(([k, v]) => [mailId(k), v])) };
  } catch (e) { throw ewsFailure(e); }
}

export type MailMessage = { id: string; from: string; subject: string; received: string; attachments: boolean; read: boolean; text: string; cut: boolean };
/** One message's whole text, read now for the person who opened it (or asked the AI about it) and never stored. Clem
 *  keeps only hashes of EWS ids, so the Inbox is listed newest first until the page that holds it (one request for a
 *  recent message). GetItem doesn't mark it read; `markRead`
 *  (only the hub's open, never the AI) then marks it read on Exchange. A refused update still opens the message: the
 *  engine records the open itself, so it shows read either way. */
export async function readMessage(client: GucClient, id: string, o: { markRead?: boolean } = {}): Promise<MailMessage & { marked?: boolean }> {
  try {
    const item = (await inbox(client, { find: id })).find((i) => mailId(i.itemId) === id);
    if (!item) throw new GucError("unavailable", "message not found", "That message is no longer in your GUC Inbox.");
    const text = parseBodies(await call(client, getBodies([item.itemId])), FULL + 1).get(item.itemId) ?? "";
    const { preview: _p, ...head } = asMail(item, "");
    let marked: boolean | undefined;
    if (o.markRead && !item.read) {
      try { parseUpdate(await call(client, markReadRequest(item.itemId, item.changeKey))); marked = true; }
      catch (e) { if (e instanceof GucError && e.kind === "offline") throw e; marked = false; }
    }
    return { ...head, read: head.read || !!o.markRead, text: text.slice(0, FULL), cut: text.length > FULL, ...(marked !== undefined ? { marked } : {}) };
  } catch (e) { throw ewsFailure(e); }
}
