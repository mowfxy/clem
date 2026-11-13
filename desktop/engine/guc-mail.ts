// GUC mail for the sync: the Inbox's message list over EWS, read-only (core/guc/ews.ts builds only
// GetFolder/FindItem/GetItem). Change detection is the set of ids, not unread flags or dates, so a late delivery is
// still caught. The first read is a baseline: what is already there is not news (but it is previewed, so the hub
// shows what each message says).
import { asMail, BODY_BATCH, EWS_AUTH, EWS_URL, EwsError, findInbox, FULL, getBodies, mailId, parseBodies, parseFind, type EwsItem } from "../../core/guc/ews.ts";
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

/** Every Inbox message (paged 100 at a time), oldest first. */
async function inbox(client: GucClient) {
  const all: EwsItem[] = [];
  for (let offset = 0, pages = 0; pages < 60; pages++) {
    const page = parseFind(await call(client, findInbox(offset)));
    all.push(...page.items);
    if (page.last || !page.items.length) break;
    offset = Number.isFinite(page.next) && page.next > offset ? page.next : offset + page.items.length;
  }
  return all;
}

/** The Inbox now: every message, previews for the ones not in `seen`, and previews for kept messages that have none yet
 *  (the baseline's, once). `seen` undefined is the first read: nothing in it is new. */
export async function readMail(client: GucClient, seen: string[] | undefined, previous: GucMail[] = []) {
  try {
    const all = await inbox(client);
    const known = new Set(seen || []);
    const fresh = seen ? all.filter((i) => !known.has(mailId(i.itemId))) : [];
    const kept = new Map(previous.map((m) => [m.id, m]));
    const newest = [...all].sort((a, b) => b.received.localeCompare(a.received)).slice(0, KEEP_MAIL);
    // A kept message already previewed (even an empty one) is not asked for again.
    const backfill = newest.filter((i) => { const was = kept.get(mailId(i.itemId)); return !was || (!was.preview && !was.previewed); });
    const need = [...new Map([...fresh, ...backfill].map((i) => [i.itemId, i])).values()];
    const mustHave = new Set(fresh.map((i) => i.itemId));
    const previews = new Map<string, string>();
    for (let i = 0; i < need.length; i += BODY_BATCH) {
      const batch = need.slice(i, i + BODY_BATCH).map((m) => m.itemId);
      const got = parseBodies(await call(client, getBodies(batch)));
      // A new message's body missing from the answer: the whole read is retried next time, nothing is marked seen.
      if (batch.some((id) => mustHave.has(id) && !got.has(id))) throw new GucError("unavailable", "incomplete_message_bodies");
      for (const [k, v] of got) previews.set(k, v);
    }
    const mail: GucMail[] = newest.map((i) => {
      const was = kept.get(mailId(i.itemId)), got = previews.get(i.itemId);
      return { ...asMail(i, got ?? was?.preview ?? ""), ...(got !== undefined || was?.previewed ? { previewed: true } : {}) };
    });
    const ids = all.map((i) => mailId(i.itemId));
    return { mail, seen: [...new Set([...(seen || []), ...ids])].slice(-KEEP_SEEN), fresh: fresh.map((i) => asMail(i, previews.get(i.itemId) || "")) };
  } catch (e) { throw ewsFailure(e); }
}

export type MailMessage = { id: string; from: string; subject: string; received: string; attachments: boolean; read: boolean; text: string; cut: boolean };
/** One message's whole text, read now for the person who opened it (or asked the AI about it) and never stored. Clem
 *  keeps only hashes of EWS ids, so the Inbox list is read again to find it. GetItem doesn't mark it read. */
export async function readMessage(client: GucClient, id: string): Promise<MailMessage> {
  try {
    const item = (await inbox(client)).find((i) => mailId(i.itemId) === id);
    if (!item) throw new GucError("unavailable", "message not found", "That message is no longer in your GUC Inbox.");
    const text = parseBodies(await call(client, getBodies([item.itemId])), FULL + 1).get(item.itemId) ?? "";
    const { preview: _p, ...head } = asMail(item, "");
    return { ...head, text: text.slice(0, FULL), cut: text.length > FULL };
  } catch (e) { throw ewsFailure(e); }
}
