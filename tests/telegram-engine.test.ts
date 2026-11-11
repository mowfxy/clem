import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardBlock } from "../core/guc/cards.ts";
import { cairoAt, mergePro, DEFAULT_PRO } from "../core/proactivity/settings.ts";
import { cardMessage, esc, markdownHtml, replyMessages } from "../core/telegram/render.ts";
import { TG_FILE_LIMIT } from "../core/telegram/pairing.ts";
import { Engine } from "../desktop/engine/index.ts";
import { TelegramRelay } from "../desktop/engine/telegram.ts";
import { runTelegramTool } from "../desktop/engine/ai-tools.ts";
import type { TelegramTurn } from "../desktop/engine/host.ts";
import { host as fakeHost } from "./guc-fake.ts";
import { account, call, fakeTelegram, hook, msg, tap, workerEnv } from "./telegram-fake.ts";

// ---------- Rendering ----------
test("render: Markdown answers become escaped Telegram HTML, split under 4096 characters", () => {
  assert.equal(esc("a < b & c > d"), "a &lt; b &amp; c &gt; d");
  assert.equal(markdownHtml("**Due** `x<y` and *soon* — [CMS](https://cms.guc.edu.eg/a?b=1&c=2) or [here](#/app/guc)"), '<b>Due</b> <code>x&lt;y</code> and <i>soon</i> — <a href="https://cms.guc.edu.eg/a?b=1&amp;c=2">CMS</a> or here');
  assert.equal(markdownHtml("## Plan\n- one\n- <script>"), "<b>Plan</b>\n• one\n• &lt;script&gt;");
  assert.equal(markdownHtml("```\nif (a < b) {}\n```"), "<pre>if (a &lt; b) {}</pre>");
  assert.equal(markdownHtml("[x](javascript:alert(1))"), "[x](javascript:alert(1))", "only http(s) links become links");
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(30)).join("\n\n");
  const parts = replyMessages(long);
  assert.ok(parts.length > 1 && parts.every((p) => p.html.length <= 4096));
  assert.ok(parts.map((p) => p.html).join("\n\n").includes("Paragraph 59"), "nothing is lost");
});

test("render: every card type is compact, escaped, with buttons where they make sense", () => {
  const name = (id?: string) => ({ circ: "Circuits <1>" } as Record<string, string>)[id || ""];
  const status = (k: string) => ({ "block:1": "applied", "routine:1": "confirm", "change:ann:1": "said" } as Record<string, string>)[k];
  const org = cardMessage({ type: "organizer", title: "Your morning", when: "morning", lines: [{ text: "Study <Thevenin> 10:00", key: "block:1" }, { text: "Make a routine", key: "routine:1" }, { text: "Lab cancelled & moved", key: "change:ann:1" }, { text: "Plain line" }] }, { name, status })!;
  assert.match(org.html, /^<b>Your morning<\/b>\n• Study &lt;Thevenin&gt; 10:00/);
  assert.deepEqual(org.buttons.map((r) => r.map((b) => b.tap.t)), [["undo"], ["confirm", "dismiss"], ["mute"], ["open"]]);
  const lec = cardMessage({ type: "lecture", subjectId: "circ", files: [{ id: "m1", name: "Lecture 3" }] }, { name })!;
  assert.match(lec.html, /New lecture in Circuits &lt;1&gt;/);
  assert.deepEqual(lec.buttons[0].map((b) => b.text), ["Summarize", "Make flashcards"]);
  assert.deepEqual(cardMessage({ type: "watch", id: "w1", text: "midterm room" })!.buttons[0][0].tap, { t: "stop", id: "w1" });
  assert.deepEqual(cardMessage({ type: "file_saved", subjectId: "circ", files: [{ id: "m2", name: "Sheet 2" }] }, { name })!.buttons.flat().map((b) => b.tap.t), ["summarize", "send", "check"]);
  for (const card of [
    { type: "brief", title: "Morning", items: [{ text: "x" }] }, { type: "reminder", title: "Sheet 3 is due in 3 hours" }, { type: "digest", lines: [{ text: "Also new: 2" }] },
    { type: "announcement", id: "a1", title: "Midterm", detail: "Room C7.02" }, { type: "grade", title: "Quiz 1: 9/10" }, { type: "deadline", id: "d1", title: "Lab report", changed: true },
    { type: "handoff", spaceId: "circ", spaceName: "Circuits", chatId: "c1" }, { type: "save_rules", subjectId: "circ" }, { type: "settings_update", subjectId: "circ", checkText: "every day at 8pm" },
    { type: "new_courses", courses: [{ key: "1:2", code: "CSEN 701", name: "Embedded" }] },
  ] as const) {
    const m = cardMessage(card as any, { name });
    assert.ok(m && m.html.length < 4096 && !/<(?!\/?(b|i|code|pre|a|s)\b)/.test(m.html), card.type);
  }
  assert.equal(cardMessage({ type: "telegram_pair" }), null, "the pair card is for Clem's window");
  const reply = replyMessages("Here it is.\n\n" + cardBlock({ type: "watch", id: "w2", text: "grades in Math" }));
  assert.deepEqual(reply.map((m) => m.buttons.length), [0, 1], "text first, then the card with its button");
});

// ---------- The engine's relay against the Worker and a fake Telegram ----------
async function setup(o: { converse?: (t: TelegramTurn) => Promise<{ text: string }>; clock?: { t: number } } = {}) {
  const env = workerEnv(), tg = fakeTelegram(), turns: TelegramTurn[] = [], opened: unknown[] = [];
  const h = Object.assign(fakeHost(), { account: account(env, tg, "owner-1"), converse: o.converse || (async (t: TelegramTurn) => { turns.push(t); return { text: "**Sheet 3** is due tomorrow." }; }), open: (x: unknown) => opened.push(x) });
  h.workspace = async () => ({ spaces: [{ id: "circ", name: "Circuits", kind: "subject" }], plans: [], chats: [{ id: "main", kind: "main", messages: [] }], files: [], studySets: [], automations: [] });
  const engine = await Engine.open("owner-1", h, { memory: true, jobs: false, ...(o.clock ? { clock: () => o.clock!.t } : {}) });
  const pairNow = async () => { const p = await engine.telegram.pair(); await hook(env, tg, msg(42, p.code)); await engine.telegram.status(true); };
  return { env, tg, h, engine, relay: engine.telegram, turns, opened, pairNow };
}
const sent = (tg: ReturnType<typeof fakeTelegram>) => tg.said().map((b) => b.text);

test("relay: a paired chat's message is answered by Clem's agent once, with typing, and acknowledged", async () => {
  const { env, tg, engine, relay, turns, pairNow } = await setup();
  try {
    assert.equal(await relay.paired(), false);
    await pairNow();
    assert.equal((await relay.status()).paired?.name, "@sara");
    await hook(env, tg, msg(42, "what's due tomorrow?"));
    assert.equal(await relay.pullOnce(), 1);
    assert.deepEqual(turns.map((t) => "text" in t && t.text), ["what's due tomorrow?"]);
    assert.ok(tg.calls.some((c) => c.method === "sendChatAction" && c.body.action === "typing"), "typing while it answers");
    assert.equal(sent(tg).at(-1), "<b>Sheet 3</b> is due tomorrow.");
    assert.equal(await relay.pullOnce(), 0, "acknowledged");
    // A redelivered item (the ack was lost) is acknowledged again but never answered twice.
    await hook(env, tg, msg(42, "again?"));
    const [row] = env.DB.db.prepare("SELECT id FROM telegram_inbox").all() as { id: string }[];
    await engine.db.query("insert into telegram_seen (owner_id, id) values ('owner-1', $1)", [row.id]);
    assert.equal(await relay.pullOnce(), 1);
    assert.equal(turns.length, 1);
    assert.equal(await relay.pullOnce(), 0);
  } finally { await engine.close(); }
});

test("relay: taps round-trip through the inbox to the same appliers; old buttons are explained", async () => {
  const { env, tg, engine, relay, turns, opened, pairNow } = await setup();
  try {
    await pairNow();
    const o = engine.organizer;
    const w = await o.watch("tell me when the midterm room is posted", []);
    await relay.reply("Watching.\n\n" + cardBlock({ type: "watch", id: w.id, text: w.text }) + "\n\n" + cardBlock({ type: "lecture", subjectId: "circ", files: [{ id: "m1", name: "Lecture 3" }] }));
    const keyboards = tg.said().filter((b) => b.reply_markup).map((b) => b.reply_markup.inline_keyboard);
    assert.match(tg.said().at(-1).text, /New lecture in Circuits/, "names come from the workspace");
    const stop = keyboards[0][0][0], summarize = keyboards[1][0][0];
    assert.equal(stop.text, "Stop watching");
    assert.match(stop.callback_data, /^b:[\w-]{12}$/, "Telegram carries only a short token");
    await hook(env, tg, tap(42, stop.callback_data));
    await hook(env, tg, tap(42, summarize.callback_data));
    await hook(env, tg, tap(42, "b:unknown-token"));
    await relay.pullOnce();
    assert.equal((await o.watches()).find((x) => x.id === w.id)?.stopped, true, "Stop watching stopped it");
    assert.deepEqual(turns.map((t) => "tap" in t && t.tap), [{ t: "summarize", subjectId: "circ", fileId: "m1", name: "Lecture 3" }], "Summarize goes to the agent");
    assert.ok(sent(tg).includes("Stopped watching."));
    assert.ok(sent(tg).some((t) => /older message/.test(t)));
    // Open in Clem opens on the PC.
    await relay.deliver({ title: "Lab moved", body: "Thursday 13:45", open: { route: "#/app/guc/schedule" } });
    await hook(env, tg, tap(42, tg.said().at(-1).reply_markup.inline_keyboard[0][0].callback_data));
    await relay.pullOnce();
    assert.deepEqual(opened, [{ route: "#/app/guc/schedule", chat: undefined, message: undefined }]);
  } finally { await engine.close(); }
});

test("notifier: Telegram is a real channel, once per key, within quiet hours, only while paired", async () => {
  const clock = { t: cairoAt("2026-11-15", "13:00") };
  const { env, tg, engine, pairNow } = await setup({ clock });
  try {
    const o = engine.organizer;
    assert.equal(await o.push("k1", "Lab moved", "Thursday", {}, undefined, { channels: ["telegram"] }), "off", "not paired: nothing, nothing recorded");
    await pairNow();
    assert.equal(await o.push("k1", "Lab moved", "Thursday", {}, undefined, { channels: ["push", "telegram"] }), "sent");
    assert.equal(await o.push("k1", "Lab moved", "Thursday", {}, undefined, { channels: ["push", "telegram"] }), "sent-before");
    assert.equal(sent(tg).filter((t) => /Lab moved/.test(t)).length, 1);
    const rows = await engine.db.query<{ channel: string }>("select channel from notifications_sent where event_key = 'k1' order by channel");
    assert.deepEqual(rows.map((r) => r.channel), ["push", "telegram"]);
    // With a card, Telegram gets the card and its buttons.
    await o.push("k2", "Due in 3 hours", "Sheet 3", {}, undefined, { channels: ["telegram"], cards: cardBlock({ type: "reminder", title: "Sheet 3 is due in 3 hours", spaceId: "circ" }) });
    assert.match(sent(tg).at(-1), /^<b>Reminder:<\/b> Sheet 3/);
    // Quiet hours hold it until they end.
    clock.t = cairoAt("2026-11-16", "01:00");
    assert.equal(await o.push("k3", "Room changed", "C7.02", {}, undefined, { channels: ["telegram"] }), "deferred");
    const before = sent(tg).length;
    clock.t = cairoAt("2026-11-16", "07:40");
    assert.equal(await o.flush(), 1);
    assert.equal(sent(tg).length, before + 1);
    assert.equal(await o.flush(), 0);
    // A sweep's urgent change goes to Telegram when the event's channels include it.
    await o.setSettings({ events: { announcement: { channels: ["app", "telegram"] } } });
    await o.sweep("event");
    clock.t = cairoAt("2026-11-16", "09:00");
    await engine.db.query("insert into guc_events (owner_id, event_key, kind, course_key, title, detail) values ('owner-1', 'ann:t1', 'new_announcement', null, 'New announcement in ELCT 201', 'Today''s lab is cancelled.')");
    await o.sweep("event");
    assert.ok(sent(tg).some((t) => /lab is cancelled/i.test(t)));
    // Unpaired: Telegram is skipped again.
    await call(env, tg, "owner-1", "/telegram/unpair", {});
    await engine.telegram.status(true);
    assert.equal(await o.push("k4", "x", "y", {}, undefined, { channels: ["telegram"] }), "off");
  } finally { await engine.close(); }
});

test("pair card: posted once on first run, once when a Telegram channel is turned on, whenever asked; never when paired", async () => {
  const { engine, pairNow } = await setup();
  try {
    const o = engine.organizer;
    assert.ok(await o.offerTelegram("first"));
    assert.equal(await o.offerTelegram("first"), undefined, "once");
    await o.setSettings({ events: { grade: { channels: ["app", "telegram"] } } });
    await o.setSettings({ events: { deadline: { channels: ["app", "telegram"] } } });
    assert.ok(await o.offerTelegram("asked"));
    const posts = (await o.inbox()).posts.filter((p) => p.content.includes('"telegram_pair"'));
    assert.equal(posts.length, 3, "first run, the channel (once), and asked");
    await pairNow();
    assert.equal(await o.offerTelegram("first"), null);
    assert.equal(await o.offerTelegram("channel"), null);
  } finally { await engine.close(); }
});

test("files: sent as a document up to 50 MB; a bigger one gets a note and Open in Clem", async () => {
  const env = workerEnv(), tg = fakeTelegram(), dir = await mkdtemp(join(tmpdir(), "clem-tg-"));
  try {
    await writeFile(join(dir, "l3.pdf"), Buffer.from("%PDF-1.4 small"));
    const files: Record<string, { name: string; type: string; size: number; path: string }> = {
      small: { name: "Lecture 3.pdf", type: "application/pdf", size: 14, path: join(dir, "l3.pdf") },
      huge: { name: "Recording.mp4", type: "video/mp4", size: TG_FILE_LIMIT + 1, path: join(dir, "missing.mp4") },
    };
    const h = Object.assign(fakeHost(), { account: account(env, tg, "owner-2") });
    const engine = await Engine.open("owner-2", h, { memory: true, jobs: false });
    const relay = new TelegramRelay({ db: engine.db, owner: "owner-2", host: h, organizer: engine.organizer, engine: { checkNow: async () => null, file: async (id) => files[id] } });
    try {
      await assert.rejects(relay.sendFile("small"), /isn't paired/);
      const p = await relay.pair();
      await hook(env, tg, msg(7, p.code));
      assert.deepEqual(await relay.sendFile("small"), { sent: true, name: "Lecture 3.pdf", size: 14 });
      assert.equal(tg.calls.at(-1)!.method, "sendDocument");
      assert.match(tg.calls.at(-1)!.body.multipart, /Lecture 3\.pdf/);
      const big = await relay.sendFile("huge");
      assert.equal(big.sent, false);
      assert.equal(tg.calls.filter((c) => c.method === "sendDocument").length, 1, "never uploaded");
      assert.match(tg.said().at(-1).text, /more than Telegram's 50 MB/);
      assert.equal(tg.said().at(-1).reply_markup.inline_keyboard[0][0].text, "Open in Clem");
    } finally { await engine.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("AI tools: telegram.pair answers with the pair card; telegram.sendFile needs pairing and a file", async () => {
  const { engine, pairNow } = await setup();
  try {
    const ctx = { engine, owner: "owner-1", subjects: [] };
    assert.match(String(await runTelegramTool(ctx, { action: "telegram.pair" })), /"type":"telegram_pair"/);
    assert.match((await runTelegramTool(ctx, { action: "telegram.sendFile", file: "Lecture 3" }) as { error: string }).error, /isn't paired/);
    await pairNow();
    assert.match(String(await runTelegramTool(ctx, { action: "telegram.pair" })), /already paired as @sara/);
    assert.match((await runTelegramTool(ctx, { action: "telegram.sendFile" }) as { error: string }).error, /needs "file"/);
    assert.match((await runTelegramTool(ctx, { action: "telegram.sendFile", file: "Lecture 3" }) as { error: string }).error, /No CMS file/);
  } finally { await engine.close(); }
});

test("settings: a Telegram channel saves like any other", () => {
  assert.deepEqual(mergePro(DEFAULT_PRO, { events: { grade: { channels: ["app", "push", "telegram"] } } }).events.grade.channels, ["app", "push", "telegram"]);
});
