// Checks how a chat row in the sidebar looks while Clem works on it and once its answer has finished elsewhere
// (the person moved to another chat): the row says so quietly, and opening the chat clears it.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/sidebar-status";
await mkdir(out, { recursive: true });
const now = Date.now();
const chat = (id, title, updated) => ({ id, title, spaceId: null, updated, messages: [{ id: id + "-m", role: "user", content: title }, { id: id + "-a", role: "assistant", content: "Earlier answer." }] });
const extraChats = [
  chat("c-a", "Functions of several variables study guide", now - 60e3),
  chat("c-b", "Payment methods and tax questions", now - 120e3),
  chat("c-c", "PSpice simulation steps", now - 180e3),
];
const long = "Here is the whole guide. ".repeat(400);
const browser = await chromium.launch();
const fixture = await openFixture(browser, { extraChats, replies: [long], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const { page, errors } = fixture;
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: 0, width: 300, height: 420 } });
try {
  await page.waitForTimeout(600);
  await page.locator(".history-title", { hasText: "Functions of several variables" }).click();
  await page.locator(".composer textarea").fill("Make the PDF again");
  await page.locator(".composer textarea").press("Enter");
  await page.locator(".history-row.is-working").first().waitFor({ timeout: 5000 });
  // Away from the chat while it works.
  await page.locator(".history-title", { hasText: "PSpice" }).click();
  await page.waitForTimeout(400);
  await shot("working");
  await page.locator(".history-row.is-unseen").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(700);
  await shot("finished");
  await page.locator(".history-row.is-unseen").first().hover();
  await page.waitForTimeout(300);
  await shot("finished-hover");
  check(await page.locator(".history-row.is-unseen").count() === 1, "the finished chat is marked");
  await page.locator(".history-row.is-unseen .history-item").click();
  await page.waitForTimeout(300);
  check(await page.locator(".history-row.is-unseen").count() === 0, "opening it clears the mark");
  check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
} finally {
  await fixture.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
