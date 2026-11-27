// Checks reactions in chats against the real App (browser fixture, not the desktop window): a subject chat and the main
// thread show saved reactions under their messages; hovering a message shows the react button; one tap reacts, a
// second removes it; reactions are saved; the next request tells the AI about them; an AI reply that is only
// [[react: 🙏]] leaves no answer, just its reaction on the person's message.
// Usage: node scripts/verify/chat-reactions.mjs [out-dir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture, saved } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/chat-reactions";
await mkdir(out, { recursive: true });
const now = Date.now(), hour = 3600e3;
const said = (id, role, content, at, extra = {}) => ({ id, role, content, at, ...extra });
const extraChats = [
  { id: "main-fixture", kind: "main", title: "Clem", titled: true, renamed: true, pinned: true, spaceId: null, updated: now - hour, messages: [
    said("mt-1", "assistant", "GUC posted a new announcement for Circuits: the lab moves to Thursday.", now - 5 * hour, { own: "news:guc-announcement", reactions: [{ emoji: "👎", by: "you", at: now - 4 * hour }] }),
    said("mt-2", "user", "What's due this week?", now - 3 * hour),
    said("mt-3", "assistant", "Two things: the Biology worksheet on Wednesday and the Circuits lab report on Friday.", now - 3 * hour, { reactions: [{ emoji: "👍", by: "you", at: now - 2 * hour }] }),
  ] },
];

const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const fixture = await openFixture(browser, { port: 5232, viewport: { width: 1280, height: 820 }, extraChats, replies: ["[[react: 🙏]]"] });
const { page, errors } = fixture;
try {
  // A subject chat: hover the answer, react, see the chip, tap again to remove.
  await page.locator(".side-chat .history-title", { hasText: "Osmosis lab write-up" }).click();
  const answer = page.locator(".message.assistant").first();
  await answer.hover();
  await page.waitForTimeout(300);
  check(await answer.locator(".cr-add").isVisible(), "hovering an answer shows the react button");
  await answer.locator(".cr-add").click();
  check(await page.locator(".cr-pick").isVisible(), "the picker opens");
  await page.screenshot({ path: `${out}/subject-picker.png` });
  await page.locator(".cr-pick button", { hasText: "👍" }).click();
  check(await answer.locator(".cr-chip.mine", { hasText: "👍" }).isVisible(), "one tap reacts");
  await saved(page);
  const stored = await page.evaluate(async () => (await (await fetch("/api/local/state", { headers: { "X-Clem-Owner": "fixture-owner" } })).json()).chats.find((c) => c.id === "c-osmosis").messages.find((m) => m.role === "assistant").reactions);
  check(stored?.[0]?.emoji === "👍" && stored[0].by === "you", "the reaction is saved with the message");
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/subject-reacted.png` });

  // The person reacts to their own message too.
  const question = page.locator(".message.user").first();
  await question.hover(); await question.locator(".cr-add").click();
  await page.locator(".cr-pick button", { hasText: "🤔" }).click();
  check(await question.locator(".cr-chip", { hasText: "🤔" }).isVisible(), "the person can react to their own message");

  // Sending: the AI is told about the reactions, and its reaction-only reply lands on the person's message.
  await page.locator(".composer textarea").fill("ok thanks");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  const req = await page.evaluate(() => window.requests.filter((r) => r.action === "chat").at(-1));
  const text = (req?.messages || []).map((m) => m.content).join("\n");
  check(/reactions, newest first[\s\S]*👍 on your answer/.test(text), "the request carries the person's reactions as feedback");
  check(/\[\[react: emoji\]\]/.test(text), "the AI is told it may react instead of replying");
  const last = page.locator(".message").last();
  check(await last.evaluate((el) => el.classList.contains("user")), "a reaction-only reply leaves no empty answer");
  check(await last.locator(".cr-chip", { hasText: "🙏" }).isVisible(), "the AI's reaction shows on the person's message");
  await page.mouse.move(5, 5); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/subject-ai-reaction.png` });

  // Tap again to remove.
  await answer.locator(".cr-chip.mine", { hasText: "👍" }).click();
  check(await answer.locator(".cr-chip", { hasText: "👍" }).count() === 0, "a second tap removes the reaction");

  // The main thread: saved reactions (including on Clem's own post) show after a reload.
  await page.locator(".nav-item", { hasText: "Clem" }).click();
  await page.locator(".chat-view.main-thread").waitFor({ timeout: 3000 });
  await page.waitForTimeout(500);
  check(await page.locator(".main-thread-list .cr-chip", { hasText: "👎" }).isVisible(), "a reaction on Clem's own post shows in the main thread");
  check(await page.locator(".main-thread-list .cr-chip", { hasText: "👍" }).isVisible(), "a reaction on an answer shows in the main thread");
  await page.screenshot({ path: `${out}/main-thread.png` });
  check(!errors.length, `no page errors (${errors.join(" | ")})`);
} finally { await fixture.close(); await browser.close(); }
process.exit(failed ? 1 : 0);
