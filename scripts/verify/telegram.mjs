// Pairing Telegram against the real App, a real in-memory engine and the account Worker's Telegram routes over a fake
// Telegram API (tests/telegram-fake.ts; nothing leaves the machine), in dark and light: the pair card the organizer posts
// in the main thread (unpaired, a code with its countdown, Connected as @name), and Settings → Channels → Telegram
// (paired, the Unpair confirmation, not connected, a code, Pair in chat).
// Usage: node scripts/verify/telegram.mjs [out-dir]   (screenshots are tg-*.png)
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";
import { Engine } from "../../desktop/engine/index.ts";
import { host } from "../../tests/guc-fake.ts";
import { account, fakeTelegram, hook, msg, workerEnv } from "../../tests/telegram-fake.ts";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/telegram";
await mkdir(out, { recursive: true });
const OWNER = "fixture-owner";
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true; return false; };

try {
  for (const theme of ["dark", "light"]) {
    const main = { id: "main-fixture", kind: "main", title: "Clem", titled: true, renamed: true, pinned: true, spaceId: null, updated: Date.now() - 3600e3, messages: [{ id: "u0", role: "user", content: "Morning!", at: Date.now() - 3600e3 }] };
    const env = workerEnv(), tg = fakeTelegram();
    const h = host();
    h.workspace = async () => ({ spaces: [], plans: [], chats: [main], files: [], studySets: [], automations: [] });
    h.account = account(env, tg, OWNER);
    const engine = await Engine.open(OWNER, h, { memory: true, jobs: false });
    const o = engine.organizer, t = engine.telegram;
    // First run, Telegram not paired: the organizer offers the card once.
    check(!!(await o.offerTelegram("first")) && !(await o.offerTelegram("first")), `${theme}: the pair card is offered once on first run`);
    const call = {
      gucStatus: () => engine.status(), gucOverview: () => engine.overview(), gucNow: () => null, gucInbox: () => [], gucNewCourses: () => [], gucLinks: () => engine.links(), gucCourses: () => engine.courses(),
      proInbox: () => o.inbox(), proAck: (r) => o.ack(r), proStatus: (r) => o.statuses(r.keys), proSettings: (r) => (r.set ? o.setSettings(r.set) : o.settings()), proLog: () => o.log(0),
      proWatches: () => o.watches(), proMutes: () => o.mutesList(), proPoke: () => 60,
      tgStatus: (r) => t.status(r.fresh), tgPair: () => t.pair(), tgUnpair: () => t.unpair(), tgOffer: () => o.offerTelegram("asked"),
    };
    const fx = await openFixture(browser, {
      port: 5243, viewport: { width: 1360, height: 900 },
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)})}catch{}`, "window.opened=[];window.open=(u)=>{window.opened.push(String(u));return null;}"],
      extraChats: [main],
      guc: async (r) => { const fn = call[r.action]; return fn ? fn(r) : null; },
    });
    const { page, errors } = fx;
    const shot = async (name, el) => { await page.waitForTimeout(450); await (el ? page.locator(el).last() : page).screenshot({ path: `${out}/tg-${name}-${theme}.png` }); };
    try {
      check(await page.locator("html").getAttribute("data-theme") === theme, `${theme}: theme applied`);
      await page.evaluate(() => window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" }));
      await page.locator(".nav-item", { hasText: "Clem" }).click();
      await page.locator(".chat-view.main-thread").waitFor({ timeout: 4000 });
      const card = page.locator(".tg-card").last();
      await card.waitFor({ timeout: 6000 });
      check(await card.getAttribute("data-state") === "unpaired" && /Talk to Clem on Telegram/.test(await card.textContent()), `${theme}: the card offers Connect Telegram`);
      await card.scrollIntoViewIfNeeded();
      await shot("card-unpaired", ".tg-card");

      await card.getByRole("button", { name: "Connect Telegram" }).click();
      check(await until(async () => (await card.getAttribute("data-state")) === "code"), `${theme}: Connect shows a code`);
      const digits = (await card.locator(".tg-code").textContent()).replace(/\s/g, "");
      check(/^\d{6}$/.test(digits), `${theme}: a 6-digit code (${digits})`);
      check((await page.evaluate(() => window.opened)).some((u) => u.endsWith("?start=" + digits)), `${theme}: Connect opens the bot with the code in the link (one tap on Start)`);
      check(/^(10:00|9:[0-5]\d)$/.test(await card.locator(".tg-left").textContent()), `${theme}: a 10-minute countdown`);
      const first = await card.locator(".tg-left").textContent();
      check(await until(async () => (await card.locator(".tg-left").textContent()) !== first, 3000), `${theme}: the countdown runs`);
      check(await card.getByRole("button", { name: /Open Telegram again/ }).count() === 1 && await card.getByRole("button", { name: "New code" }).count() === 1, `${theme}: Open Telegram again and New code`);
      await shot("card-code", ".tg-card");

      // The person sends the code to the bot: the card turns into Connected, live.
      await hook(env, tg, msg(42, "/start " + digits));
      check(await until(async () => (await card.getAttribute("data-state")) === "paired", 8000), `${theme}: the card updates to paired`);
      check(/Connected as @sara/.test(await card.textContent()) && await card.getByRole("button", { name: "Unpair" }).count() === 1, `${theme}: Connected as @sara, with Unpair`);
      await shot("card-paired", ".tg-card");

      // Settings → Channels → Telegram shows the same thing.
      await page.keyboard.press("Control+,");
      await page.locator(".st-dialog").waitFor();
      await page.locator(".st-nav button", { hasText: "Telegram" }).click();
      const settings = page.locator(".st-dialog");
      await settings.getByText("Connected as @sara").waitFor({ timeout: 4000 });
      check(await settings.getByRole("button", { name: "Open Proactivity" }).count() === 1, `${theme}: settings link to what comes to Telegram`);
      await shot("settings-paired", ".st-dialog");
      await settings.getByRole("button", { name: "Unpair" }).click();
      await page.locator(".app-confirm").waitFor();
      check(/Unpair Telegram\?/.test(await page.locator(".app-confirm").textContent()), `${theme}: Unpair asks first`);
      await shot("settings-unpair-confirm");
      await page.locator(".app-confirm-ok").click();
      await settings.getByText("Not connected").waitFor({ timeout: 4000 });
      check(!(await t.status(true)).paired && tg.said().some((m) => /Unpaired/.test(m.text)), `${theme}: unpaired with the account, and the chat is told`);
      await shot("settings-unpaired", ".st-dialog");
      await settings.getByRole("button", { name: "Connect Telegram" }).click();
      await settings.locator(".tg-code").waitFor({ timeout: 4000 });
      check(/Expires in/.test(await settings.textContent()), `${theme}: settings show a code with its countdown`);
      await shot("settings-code", ".st-dialog");
      check(await card.getAttribute("data-state") === "code", `${theme}: the card in the thread shows the same code`);
      // Re-pair with that code; then Unpair from the card itself.
      const code2 = (await settings.locator(".tg-code").textContent()).replace(/\s/g, "");
      await hook(env, tg, msg(42, code2));
      check(await until(async () => /Connected as/.test(await settings.textContent()), 8000), `${theme}: re-pairing works`);
      await page.keyboard.press("Escape");
      await page.locator(".st-dialog").waitFor({ state: "detached", timeout: 4000 });
      await card.getByRole("button", { name: "Unpair" }).click();
      await page.locator(".app-confirm-ok").click();
      check(await until(async () => (await card.getAttribute("data-state")) === "unpaired"), `${theme}: Unpair from the card`);
      // Pair in chat (Settings): the main thread opens with a fresh card.
      const before = await page.locator(".tg-card").count();
      await page.keyboard.press("Control+,");
      await page.locator(".st-nav button", { hasText: "Telegram" }).click();
      await settings.getByRole("button", { name: "Pair in chat" }).click();
      check(await until(async () => (await page.locator(".chat-view.main-thread .tg-card").count()) === before + 1 && !(await page.locator(".st-dialog").count())), `${theme}: Pair in chat opens the main thread with a new card`);
      await shot("card-asked", ".chat-view.main-thread");
      check(!errors.length, `${theme}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
    } catch (e) { check(false, `${theme}: ${e.message.split("\n")[0]}`); await shot("failure").catch(() => {}); }
    finally { await fx.close(); await engine.close(); }
  }
} finally { await browser.close(); }
console.log(failed ? "Telegram check failed." : "Telegram verified; screenshots in " + out);
process.exit(failed ? 1 : 0);
