import test from "node:test";
import assert from "node:assert/strict";
import { canIssue, codeHash, CODES_PER_HOUR, deepLink, keyboardOk, left, newCode, readCode, TG_FILE_LIMIT } from "../core/telegram/pairing.ts";
// @ts-expect-error plain JavaScript worker module
import { NOT_PAIRED, PAIRED, BAD_CODE, OFFLINE } from "../cloudflare/telegram.js";
import { call, fakeTelegram, hook, msg, tap, workerEnv as ENV } from "./telegram-fake.ts";

const said = (tg: any) => tg.calls.filter((c: any) => c.method === "sendMessage").map((c: any) => c.body.text);

test("pairing codes: six digits, read from /start or typed, hashed, rate-limited, keyboards checked", async () => {
  assert.match(newCode(), /^\d{6}$/);
  assert.equal(newCode(() => 42), "000042");
  assert.equal(newCode((() => { const xs = [4_294_967_295, 7]; return () => xs.shift()!; })()), "000007", "values past the last full million are drawn again");
  assert.equal(readCode("/start 123456"), "123456");
  assert.equal(readCode("/start@ClemBot 123456"), "123456");
  assert.equal(readCode(" 123 456 "), "123456");
  assert.equal(readCode("1234567"), null);
  assert.equal(readCode("hello"), null);
  const h = await codeHash("123456", "pepper");
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.notEqual(h, await codeHash("123456", "other"), "keyed by the Worker secret");
  assert.equal(canIssue(CODES_PER_HOUR - 1), true);
  assert.equal(canIssue(CODES_PER_HOUR), false);
  assert.equal(deepLink("ClemBot", "001234"), "https://t.me/ClemBot?start=001234");
  assert.equal(left(1_000 + 9 * 60_000 + 41_000, 1_000), "9:41");
  assert.equal(keyboardOk([[{ text: "Undo", data: "b:abc" }, { text: "Open", url: "https://clem.m4labs.xyz" }]]), true);
  assert.equal(keyboardOk([[{ text: "x", data: "undo:" + "k".repeat(80) }]]), false, "only engine tokens");
  assert.equal(keyboardOk([[{ text: "x", url: "javascript:alert(1)" }]]), false);
});

test("worker: a code pairs a chat once, expires after 10 minutes, and only paired chats are answered", async () => {
  const env = ENV(), tg = fakeTelegram();
  assert.deepEqual((await call(env, tg, "u1", "/telegram")).paired, null);
  const p = await call(env, tg, "u1", "/telegram/pair", {});
  assert.match(p.code, /^\d{6}$/);
  assert.equal(p.link, "https://t.me/ClemBot?start=" + p.code);
  assert.ok(p.expires - Date.now() > 9 * 60_000 && p.expires - Date.now() <= 10 * 60_000);
  const stored = env.DB.db.prepare("SELECT hash FROM telegram_pairings").all() as { hash: string }[];
  assert.equal(stored.length, 1);
  assert.ok(!stored[0].hash.includes(p.code), "only the hash is kept");
  // A stranger is told politely; a wrong secret header is refused.
  assert.equal((await hook(env, tg, msg(500, "hi"), "wrong".padEnd(40, "x"))).status, 403);
  await hook(env, tg, msg(500, "hi"));
  assert.equal(said(tg).at(-1), NOT_PAIRED);
  // The deep link's /start pairs; the same code again does nothing.
  await hook(env, tg, msg(42, "/start " + p.code));
  assert.equal(said(tg).at(-1), PAIRED);
  await hook(env, tg, msg(43, p.code));
  assert.equal(said(tg).at(-1), BAD_CODE, "single use");
  const st = await call(env, tg, "u1", "/telegram");
  assert.equal(st.paired.name, "@sara");
  // The paired chat's messages wait in the inbox, sealed; another person in that chat is not answered as the owner.
  await hook(env, tg, msg(42, "what's due this week?"));
  assert.equal(said(tg).at(-1), OFFLINE, "the engine hasn't pulled yet: told once");
  await hook(env, tg, msg(42, "and tomorrow?"));
  assert.equal(said(tg).filter((t: string) => t === OFFLINE).length, 1, "at most once an hour");
  await hook(env, tg, msg(42, "sneaky", 99));
  assert.equal(said(tg).at(-1), NOT_PAIRED);
  const raw = env.DB.db.prepare("SELECT sealed FROM telegram_inbox").all() as { sealed: Uint8Array }[];
  assert.equal(raw.length, 2);
  assert.ok(!Buffer.from(raw[0].sealed).toString("latin1").includes("due this week"), "encrypted at rest");
  // Expired codes don't pair.
  const q = await call(env, tg, "u2", "/telegram/pair", {});
  env.DB.db.prepare("UPDATE telegram_pairings SET expires_at=?").run(Date.now() - 1);
  await hook(env, tg, msg(77, q.code));
  assert.equal(said(tg).at(-1), BAD_CODE);
});

test("worker: codes per hour and tries per minute are limited", async () => {
  const env = ENV(), tg = fakeTelegram();
  for (let i = 0; i < CODES_PER_HOUR; i++) assert.ok((await call(env, tg, "u1", "/telegram/pair", {})).code);
  assert.match((await call(env, tg, "u1", "/telegram/pair", {})).error, /a lot of codes/);
  assert.equal((env.DB.db.prepare("SELECT count(*) AS n FROM telegram_pairings").get() as any).n, 1, "a new code replaces the last");
  for (let i = 0; i < 5; i++) await hook(env, tg, msg(9, "000000"));
  await hook(env, tg, msg(9, "000001"));
  assert.match(said(tg).at(-1), /Too many tries/);
});

test("worker: inbox pull and ack are idempotent; taps round-trip; replies, typing and files go to the paired chat", async () => {
  const env = ENV(), tg = fakeTelegram();
  const p = await call(env, tg, "u1", "/telegram/pair", {});
  await hook(env, tg, msg(42, p.code));
  const first = await call(env, tg, "u1", "/telegram/inbox", undefined, "?wait=0");
  assert.deepEqual(first, { paired: true, items: [] }, "a pull also marks the engine online");
  const m = msg(42, "send me lecture 3 slides");
  await hook(env, tg, m);
  await hook(env, tg, m); // Telegram resends an update: kept once
  await hook(env, tg, tap(42, "b:tok123"));
  assert.ok(!said(tg).includes(OFFLINE), "online: no offline note");
  assert.equal(tg.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.body.text, "On it…");
  const got = await call(env, tg, "u1", "/telegram/inbox", undefined, "?wait=5");
  assert.deepEqual(got.items.map((i: any) => [i.kind, i.text || i.data]), [["message", "send me lecture 3 slides"], ["tap", "b:tok123"]]);
  assert.deepEqual((await call(env, tg, "u1", "/telegram/inbox", undefined, "?wait=0")).items, [], "leased: not handed out twice");
  env.DB.db.prepare("UPDATE telegram_inbox SET lease_until=0").run();
  assert.equal((await call(env, tg, "u1", "/telegram/inbox")).items.length, 2, "not acknowledged: handed out again after the lease");
  assert.equal((await call(env, tg, "u1", "/telegram/ack", { ids: got.items.map((i: any) => i.id) })).acked, 2);
  assert.equal((await call(env, tg, "u1", "/telegram/ack", { ids: got.items.map((i: any) => i.id) })).acked, 2, "acking again is harmless");
  env.DB.db.prepare("UPDATE telegram_inbox SET lease_until=0").run();
  assert.deepEqual((await call(env, tg, "u1", "/telegram/inbox")).items, []);
  // Someone else's tap in that chat, or a tap on a stranger's chat, goes nowhere.
  await hook(env, tg, tap(42, "b:tok123", 99));
  await hook(env, tg, tap(500, "b:tok123"));
  assert.equal((env.DB.db.prepare("SELECT count(*) AS n FROM telegram_inbox").get() as any).n, 0);
  // Replies: HTML with buttons, plain text when Telegram can't read the HTML.
  assert.ok((await call(env, tg, "u1", "/telegram/send", { html: "<b>Hi</b>", buttons: [[{ text: "Undo", data: "b:x1" }]] })).ok);
  const sent = tg.calls.filter((c) => c.method === "sendMessage").at(-1)!.body;
  assert.equal(sent.chat_id, 42); assert.equal(sent.parse_mode, "HTML");
  assert.deepEqual(sent.reply_markup.inline_keyboard, [[{ text: "Undo", callback_data: "b:x1" }]]);
  assert.ok((await call(env, tg, "u1", "/telegram/send", { html: "<broken &amp; text" })).ok);
  assert.equal(said(tg).at(-1), "<broken & text");
  assert.match((await call(env, tg, "u1", "/telegram/send", { html: "x", buttons: [[{ text: "x", data: "evil" }]] })).error, /Invalid buttons/);
  await call(env, tg, "u1", "/telegram/typing", {});
  assert.equal(tg.calls.at(-1)!.body.action, "typing");
  const form = new FormData();
  form.set("file", new File([new Uint8Array([37, 80, 68, 70])], "Lecture 3.pdf", { type: "application/pdf" }));
  form.set("caption", "Lecture 3");
  assert.ok((await call(env, tg, "u1", "/telegram/file", form)).ok);
  assert.equal(tg.calls.at(-1)!.method, "sendDocument");
  assert.match(tg.calls.at(-1)!.body.multipart, /Lecture 3\.pdf/);
  const big = new FormData();
  big.set("file", new File([new Uint8Array(TG_FILE_LIMIT + 1)], "huge.mp4"));
  assert.match((await call(env, tg, "u1", "/telegram/file", big)).error, /50 MB/);
  // Unpair: the chat is told, the inbox emptied; re-pairing works.
  await call(env, tg, "u1", "/telegram/unpair", {});
  assert.match(said(tg).at(-1), /Unpaired/);
  assert.equal((await call(env, tg, "u1", "/telegram")).paired, null);
  assert.equal((await call(env, tg, "u1", "/telegram/send", { html: "x" })).paired, false);
  const again = await call(env, tg, "u1", "/telegram/pair", {});
  await hook(env, tg, msg(42, again.code));
  assert.equal(said(tg).at(-1), PAIRED);
  // /unpair from Telegram itself.
  await hook(env, tg, msg(42, "/unpair"));
  assert.equal((await call(env, tg, "u1", "/telegram")).paired, null);
});

test("worker: Telegram stays off until its secrets and bot name are set", async () => {
  const env = { ...ENV(), TELEGRAM_BOT_USERNAME: "" }, tg = fakeTelegram();
  assert.deepEqual(await call(env, tg, "u1", "/telegram"), { configured: false, paired: null });
  assert.match((await call(env, tg, "u1", "/telegram/pair", {})).error, /isn't set up/);
  assert.equal((await hook(env, tg, msg(1, "hi"))).status, 404);
  assert.equal(tg.calls.length, 0);
});
