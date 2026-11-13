// GUC mail for the sync: the Inbox's message list over EWS, bodies only for messages not seen before, read-only
// (core/guc/ews.ts builds only GetFolder/FindItem/GetItem). Change detection is the set of ids, not unread flags or
// dates, so a late delivery is still caught. The first read is a baseline: what is already there is not news.
import { asMail, BODY_BATCH, EWS_AUTH, EWS_URL, EwsError, findInbox, getBodies, mailId, parseBodies, parseFind, type EwsItem } from "../../core/guc/ews.ts";
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

/** The Inbox now: every message (paged 100 at a time) and previews for the ones not in `seen`. `seen` undefined is the
 *  first read: a baseline, with no previews fetched and nothing new. */
export async function readMail(client: GucClient, seen: string[] | undefined, previous: GucMail[] = []) {
  try {
    const all: EwsItem[] = [];
    for (let offset = 0, pages = 0; pages < 60; pages++) {
      const page = parseFind(await call(client, findInbox(offset)));
      all.push(...page.items);
      if (page.last || !page.items.length) break;
      offset = Number.isFinite(page.next) && page.next > offset ? page.next : offset + page.items.length;
    }
    const known = new Set(seen || []);
    const fresh = seen ? all.filter((i) => !known.has(mailId(i.itemId))) : [];
    const previews = new Map<string, string>();
    for (let i = 0; i < fresh.length; i += BODY_BATCH) {
      const batch = fresh.slice(i, i + BODY_BATCH).map((m) => m.itemId);
      const got = parseBodies(await call(client, getBodies(batch)));
      // A body missing from the answer: the whole read is retried next time, nothing is marked seen.
      if (batch.some((id) => !got.has(id))) throw new GucError("unavailable", "incomplete_message_bodies");
      for (const [k, v] of got) previews.set(k, v);
    }
    const kept = new Map(previous.map((m) => [m.id, m]));
    const newest = [...all].sort((a, b) => b.received.localeCompare(a.received)).slice(0, KEEP_MAIL)
      .map((i) => { const id = mailId(i.itemId), was = kept.get(id); return asMail(i, previews.get(i.itemId) ?? was?.preview ?? ""); });
    const ids = all.map((i) => mailId(i.itemId));
    return { mail: newest, seen: [...new Set([...(seen || []), ...ids])].slice(-KEEP_SEEN), fresh: fresh.map((i) => asMail(i, previews.get(i.itemId) || "")) };
  } catch (e) { throw ewsFailure(e); }
}
