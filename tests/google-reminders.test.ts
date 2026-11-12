// "Add reminders to Google Calendar" (docs/MAIN-THREAD.md "Calendar, reminders and study time"): the engine keeps Clem's
// own "Clem" calendar in step with the person's reminders, and CalendarLive writes only to that calendar.
import test from "node:test";
import assert from "node:assert/strict";
import { CalendarLive, WRITE_SCOPE } from "../desktop/calendar-live.ts";
import { Engine } from "../desktop/engine/index.ts";
import { host as fakeHost } from "./guc-fake.ts";

const T = (iso: string) => Date.parse(iso);

async function engine(clock: { t: number }) {
  const events = new Map<string, { text: string; at: number; repeat?: string }>(), log = { added: 0, removed: 0, down: false };
  const h = fakeHost();
  h.workspace = async () => ({ spaces: [], plans: [], chats: [{ id: "main", kind: "main", messages: [] }], files: [], studySets: [], automations: [] });
  h.calendarEvents = {
    add: async (e) => { if (log.down) throw Error("offline"); const id = "ev" + (++log.added); events.set(id, e); return id; },
    remove: async (id) => { if (log.down) throw Error("offline"); log.removed++; events.delete(id); },
  };
  const e = await Engine.open("gr-owner", h, { memory: true, jobs: false, clock: () => clock.t });
  return { e, o: e.organizer, events, log };
}

test("engine: reminders go to Google only once it is on; cancelling, or turning it off, takes them out", async () => {
  const clock = { t: T("2026-11-15T10:00:00Z") }, { e, o, events, log } = await engine(clock);
  try {
    assert.equal((await o.settings()).googleReminders, false, "off by default");
    const a = await o.remind({ text: "Submit the lab report", at: T("2026-11-16T07:00:00Z") });
    await o.syncGoogle();
    assert.equal(events.size, 0, "off: nothing goes to Google");

    await o.setSettings({ googleReminders: true });
    await o.syncGoogle();
    assert.deepEqual([...events.values()].map((x) => x.text), ["Submit the lab report"], "turning it on adds what is upcoming");
    const daily = await o.remind({ text: "Flashcards", at: T("2026-11-15T13:00:00Z"), repeat: "daily" });
    await o.syncGoogle();
    assert.equal([...events.values()].find((x) => x.text === "Flashcards")?.repeat, "daily");
    await o.syncGoogle();
    assert.equal(log.added, 2, "each reminder once");

    // Offline: the cancel is kept and tried again later.
    log.down = true;
    await o.cancelReminder(a.id);
    await o.syncGoogle();
    assert.equal(events.size, 2);
    log.down = false;
    await o.tick();
    assert.deepEqual([...events.values()].map((x) => x.text), ["Flashcards"]);

    await o.setSettings({ googleReminders: false });
    await o.syncGoogle();
    assert.equal(events.size, 0, "off: upcoming ones leave Google");
    assert.ok((await o.reminders()).some((x) => x.id === daily.id), "and stay in Clem");
  } finally { await e.close(); }
});

function google(scope: string) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  let own: string | null = null;
  const fetcher = (async (input: string, init: RequestInit = {}) => {
    const url = String(input), method = init.method || "GET", body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/api/calendar/token")) return json({ accessToken: "t", expiresIn: 3300, scope });
    if (url.includes("/users/me/calendarList")) return json({ items: [{ id: "primary@x", primary: true, accessRole: "owner" }, ...(own ? [{ id: own, summary: "Clem", accessRole: "owner", description: body?.description ?? "Reminders you set in Clem. Clem adds and removes these; your other calendars are only read." }] : [])] });
    if (url.endsWith("/calendars") && method === "POST") { own = "clem@group"; return json({ id: own }); }
    if (/\/calendars\/[^/]+\/events$/.test(url) && method === "POST") return json({ id: "e1" });
    if (/\/events\/e1$/.test(url) && method === "DELETE") return new Response(null, { status: 204 });
    if (/\/events\?/.test(url)) return json({ items: [{ id: url.includes("clem%40group") ? "fromClem" : "fromPrimary", summary: "Quiz", start: { dateTime: "2026-11-16T08:00:00Z" }, end: { dateTime: "2026-11-16T09:00:00Z" } }] });
    return json({}, 404);
  }) as typeof fetch;
  return { live: new CalendarLive(async () => "session", fetcher, "https://clem.test"), calls };
}

test("CalendarLive: writes only to its own calendar, made once; never reads it back", async () => {
  const { live, calls } = google(`https://www.googleapis.com/auth/calendar.readonly ${WRITE_SCOPE}`);
  assert.equal((await live.state()).write, true);
  const id = await live.addReminder({ text: "Submit the lab report", at: T("2026-11-16T07:00:00Z"), repeat: "weekly" });
  assert.equal(id, "e1");
  const made = calls.filter((c) => c.method === "POST" && c.url.endsWith("/calendars"));
  assert.equal(made.length, 1);
  assert.equal(made[0].body?.summary, "Clem");
  const event = calls.find((c) => c.method === "POST" && c.url.endsWith("/events"))!;
  assert.match(event.url, /clem%40group/, "into Clem's calendar, not the primary one");
  assert.deepEqual(event.body?.recurrence, ["RRULE:FREQ=WEEKLY"]);
  assert.deepEqual((event.body?.reminders as { overrides: unknown[] }).overrides, [{ method: "popup", minutes: 0 }]);
  await live.addReminder({ text: "Again", at: T("2026-11-17T07:00:00Z") });
  assert.equal(calls.filter((c) => c.method === "POST" && c.url.endsWith("/calendars")).length, 1, "the calendar is made once");
  await live.removeReminder("e1");
  assert.ok(calls.some((c) => c.method === "DELETE" && /clem%40group\/events\/e1$/.test(c.url)));
  const read = await live.between(T("2026-11-16T00:00:00Z"), T("2026-11-17T00:00:00Z"));
  assert.deepEqual(read?.map((e) => e.id), ["fromPrimary"], "its own reminders are not read back as events");
});

test("CalendarLive: connected read-only, it never writes", async () => {
  const { live, calls } = google("https://www.googleapis.com/auth/calendar.readonly");
  assert.deepEqual(await live.state(), { connected: true, checked: true, write: false });
  assert.equal(await live.addReminder({ text: "x", at: T("2026-11-16T07:00:00Z") }), null);
  assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});
