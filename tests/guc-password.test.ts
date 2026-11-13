import test from "node:test";
import assert from "node:assert/strict";
import { cardsIn } from "../core/guc/cards.ts";
import { AUTH_RETRY_MS, authKey, PASSWORD_ROUTE, PASSWORD_SAID, passwordChannels, passwordDue, reminderKey } from "../core/guc/password.ts";
import { cairoAt, DEFAULT_PRO } from "../core/proactivity/settings.ts";
import { cardMessage } from "../core/telegram/render.ts";
import { Engine } from "../desktop/engine/index.ts";
import { fakeGuc, host, noWait, site } from "./guc-fake.ts";
import { urls } from "../core/guc/parse.ts";

// Sunday 15 November 2026, Cairo; quiet hours 23:00–07:30 by default.
const T = (day: string, hm: string) => cairoAt(day, hm);

test("password: the notice on the day it failed, then one reminder a day, never in quiet hours", () => {
  const since = T("2026-11-15", "13:00");
  assert.equal(passwordDue(null, since, DEFAULT_PRO), null, "works: nothing owed");
  assert.deepEqual(passwordDue(since, T("2026-11-15", "23:30"), DEFAULT_PRO), { kind: "notice", key: "guc-auth:2026-11-15" }, "the notice's pushes wait out quiet hours in the queue");
  assert.equal(passwordDue(since, T("2026-11-16", "02:00"), DEFAULT_PRO), null, "no reminder in quiet hours");
  assert.deepEqual(passwordDue(since, T("2026-11-16", "09:00"), DEFAULT_PRO), { kind: "reminder", key: "guc-auth-reminder:2026-11-16" });
  assert.equal(passwordDue(since, T("2026-11-16", "21:00"), DEFAULT_PRO)?.key, reminderKey(T("2026-11-16", "09:00")), "one key a day, so one reminder a day");
  assert.equal(authKey(T("2026-11-15", "23:59")), "guc-auth:2026-11-15", "keyed by the Cairo day of the first failure");
  assert.ok(AUTH_RETRY_MS >= 1000 && AUTH_RETRY_MS <= 30_000, "a short wait");
});

test("password: everywhere they can be reached (Telegram only once paired); Telegram's card opens Settings on the field", () => {
  assert.deepEqual(passwordChannels(DEFAULT_PRO), ["push", "telegram"]);
  const tg = cardMessage({ type: "guc_password" })!;
  assert.match(tg.html, /enter the new one/);
  assert.deepEqual(tg.buttons, [[{ text: "Update password", tap: { t: "open", route: "#" + PASSWORD_ROUTE } }]]);
});

test("engine: retry once, then password_needed: jobs paused, nothing wiped, told once, a daily reminder, resumed with a catch-up", async () => {
  const pw = { password: "secret" }, guc = fakeGuc(site(), pw), h = host(), clock = { t: T("2026-11-15", "13:00") }, telegram: string[] = [];
  const told = () => h.notices.filter((n) => n === PASSWORD_SAID || n.startsWith("Clem paused"));
  const engine = await Engine.open("owner-pw", h, { http: guc.http, sleep: noWait, memory: true, clock: () => clock.t });
  engine.organizer.telegram = { available: true, paired: async () => true, status: async () => ({ configured: true }), deliver: async (n) => { const t = cardsIn(n.cards || "").map((c) => c.type).join(); if (t === "guc_password") telegram.push(t); } };
  const jobs = (engine as any).jobs, schedules = async () => (await jobs.schedules()).filter((s: any) => s.name.startsWith("guc.")).map((s: any) => s.name + (s.key ? "/" + s.key : "")).sort();
  const rows = async () => (await engine.db.query<{ n: number }>("select (select count(*) from guc_courses) + (select count(*) from guc_materials) + (select count(*) from subject_links) as n"))[0].n;
  try {
    await engine.connect("student.name", "secret");
    await engine.link("subj-1", "1201:64");
    await engine.organizer.setSettings({ events: { grade: { channels: ["app", "push", "telegram"] } } });
    const before = await schedules(), data = await rows(), settings = (await engine.subject("subj-1")).settings;
    assert.deepEqual(before, ["guc.check/subj-1/m0h12.21d0", "guc.sync"]);

    // The uni changed the password.
    pw.password = "new-secret"; guc.log.length = 0;
    await assert.rejects(engine.sync(), (e: Error) => e.message === PASSWORD_SAID);
    assert.equal(guc.log.length, 2, "tried once more, then stopped");
    const status = await engine.status();
    assert.equal(status.passwordNeeded, true); assert.equal(status.connected, true, "not a disconnect");
    assert.equal((await engine.overview()).passwordNeeded, true);
    assert.deepEqual(await schedules(), [], "every GUC job paused");
    assert.equal(await rows(), data, "no data wiped");
    assert.deepEqual((await engine.subject("subj-1")).settings, settings, "no settings changed");
    assert.deepEqual(told(), [PASSWORD_SAID], "the desktop notice");
    assert.deepEqual(telegram, ["guc_password"], "Telegram, with its Update password card");
    const { posts } = await engine.organizer.inbox();
    assert.deepEqual(posts.flatMap((p) => cardsIn(p.content).map((c) => c.type)).filter((t) => t === "guc_password"), ["guc_password"], "the card in the main thread");

    // Paused: nothing reaches GUC, nothing is said again.
    await assert.rejects(engine.sync(), (e: Error) => e.message === PASSWORD_SAID);
    await assert.rejects(engine.check("subj-1", "now"));
    await engine.setSettings("subj-1", { check: { mode: "custom", times: [{ day: 2, time: "18:00" }], tz: "Africa/Cairo" } });
    assert.deepEqual(await schedules(), [], "a settings change doesn't wake the checks");
    assert.equal(guc.log.length, 2, "no request while paused");
    await engine.organizer.tick();
    assert.equal(told().length, 1, "deduped by guc-auth:<day>");

    // Next day: none in quiet hours, then one gentle reminder.
    clock.t = T("2026-11-16", "02:00"); await engine.organizer.tick();
    assert.equal(told().length, 1);
    clock.t = T("2026-11-16", "10:00"); await engine.organizer.tick();
    clock.t = T("2026-11-16", "18:00"); await engine.organizer.tick();
    assert.equal(told().length, 2, "one reminder that day");
    assert.match(told()[1], /paused/);
    assert.equal(telegram.length, 2);
    assert.equal((await engine.organizer.inbox()).posts.filter((p) => p.content.includes("guc_password")).length, 1, "reminders don't add cards");

    // Update password: a wrong one changes nothing; the right one resumes and catches up.
    await assert.rejects(engine.updatePassword("still-wrong"), /didn't accept that password/);
    assert.equal((await engine.status()).passwordNeeded, true);
    guc.log.length = 0;
    const after = await engine.updatePassword("new-secret");
    assert.equal(after.passwordNeeded, undefined); assert.equal(after.error, undefined);
    await engine.catchUp;
    assert.ok(guc.log.length > 1, "a catch-up check ran");
    assert.deepEqual(await schedules(), ["guc.check/subj-1/m0h18d2", "guc.sync"], "jobs back, from the settings as they are now");
    assert.deepEqual((h.store.get("guc-owner-pw") as any).password, "new-secret", "kept in the Vault");
    clock.t = T("2026-11-17", "10:00"); await engine.organizer.tick();
    assert.equal(told().length, 2, "no reminder once it works");
  } finally { await engine.close(); }
});

test("engine: a sign-in refused past the home page is that page's trouble, never a password notice", async () => {
  const guc = fakeGuc(site()), h = host(), broken = { on: false };
  const http: typeof guc.http = async (r, c) => (broken.on && r.url !== urls.home ? { status: 401, headers: {}, body: "" } : guc.http(r, c));
  const engine = await Engine.open("owner-pw-false", h, { http, sleep: noWait, memory: true });
  try {
    await engine.connect("student.name", "secret");
    broken.on = true;
    await assert.rejects(engine.sync(), (e: Error) => e.message !== PASSWORD_SAID);
    const status = await engine.status();
    assert.equal(status.passwordNeeded, undefined, "the home page took the password: not flagged");
    assert.notEqual(status.error?.kind, "auth");
    assert.ok(!h.notices.includes(PASSWORD_SAID), "nobody is asked for a new password");
    assert.equal((await engine.organizer.inbox()).posts.filter((p) => p.content.includes("guc_password")).length, 0);
    broken.on = false;
    assert.equal((await engine.sync()).error, undefined, "and the next sync is fine");
  } finally { await engine.close(); }
});

test("engine: a flag that turns out false clears by itself: the saved password is tried again, quietly", async () => {
  const pw = { password: "secret" }, guc = fakeGuc(site(), pw), h = host();
  const engine = await Engine.open("owner-pw-heal", h, { http: guc.http, sleep: noWait, memory: true });
  const jobs = (engine as any).jobs, schedules = async () => (await jobs.schedules()).filter((s: any) => s.name === "guc.sync").length;
  try {
    await engine.connect("student.name", "secret");
    pw.password = "hiccup";
    await assert.rejects(engine.sync());
    assert.equal((await engine.status()).passwordNeeded, true);
    guc.log.length = 0;
    assert.equal(await engine.recheckPassword(), false, "still refused: still paused");
    assert.equal(guc.log.length, 1, "one request, no more");
    assert.equal((await engine.status()).passwordNeeded, true);
    pw.password = "secret";
    assert.equal(await engine.recheckPassword(), true);
    await engine.catchUp;
    const status = await engine.status();
    assert.equal(status.passwordNeeded, undefined); assert.equal(status.error, undefined);
    assert.equal(await schedules(), 1, "the sync is back on");
    assert.equal(await engine.recheckPassword(), false, "nothing to do once it works");
  } finally { await engine.close(); }
});
