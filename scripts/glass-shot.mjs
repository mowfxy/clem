// Screenshots the workspace from the browser fixture, for looking at the glass design: home, a chat, a subject and
// settings, in both themes. Scripted data only; nothing here touches an installed Clem or a signed-in profile.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture, workspace } from "./verify/local-power-fixture.mjs";

const out = process.argv[2] || "test-results/glass";
const label = process.argv[3] || "after";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
// Five months of study, so the widgets show what a real workspace would.
const now = Date.now(), DAY = 864e5, topics = ["Krebs cycle recap", "Meiosis vs mitosis", "Enzyme kinetics problems", "Past paper 2024 Q3", "Membrane transport"];
const extraChats = Array.from({ length: 60 }, (_, i) => {
  const at = now - Math.floor((Math.sin(i * 12.9) * 0.5 + 0.5) * 150 + (i < 6 ? -148 + i * 2 : 0)) * DAY - i * 3e6;
  const asked = 1 + (i * 7) % 5, id = "x" + i;
  return { id, title: topics[i % 5], spaceId: i % 2 ? "bio" : null, updated: at, messages: Array.from({ length: asked }, (_, k) => [{ id: id + k + "u", role: "user", content: "Question", at }, { id: id + k + "a", role: "assistant", content: "Answer", at }]).flat() };
});
const day = (d) => { const t = new Date(now + d * DAY); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
workspace.spaces[0].examDate = day(12);
workspace.plans = [{ id: "p", spaceId: "bio", title: "Midterm", start: day(-5), created: now, updated: now, rev: 1, tasks: [
  { id: "t1", title: "Finish organelle flashcards", due: day(-1) }, { id: "t2", title: "Past paper: membranes section", due: day(0) },
  { id: "t3", title: "Summarise week 4 lecture", due: day(2) }, { id: "t4", title: "Practice osmosis calculations", due: day(4) }, { id: "t5", title: "Mock exam", due: day(9) }] }];
workspace.studySets[0].attempts = [{ at: now - DAY, correct: 7, total: 9 }, { at: now - 40 * DAY, correct: 3, total: 5 }];
const fixture = await openFixture(browser, { extraChats, viewport: { width: 1440, height: 900 } });
const { page, errors } = fixture;
const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${label}-${name}.png` }); };
try {
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; window.dispatchEvent(new CustomEvent("clem-theme", { detail: "dark" })); });
  await page.waitForTimeout(1200);
  await shot("home");
  await page.locator(".composer .picker-trigger, .composer [aria-haspopup]").first().click().catch(() => {});
  await shot("picker");
  await page.keyboard.press("Escape");
  await page.locator(".composer-tools button").first().click();
  await shot("popover");
  await page.keyboard.press("Escape");
  await page.mouse.click(1000, 40);
  await page.locator(".history-title", { hasText: "Osmosis lab" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.locator(".sidebar .history-item").first().click();
  await shot("chat");
  await page.locator(".sidebar .nav-item", { hasText: /Subjects/ }).click();
  await shot("subjects");
  await page.locator(".profile-settings").click();
  await shot("settings");
  await page.keyboard.press("Escape");
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; window.dispatchEvent(new CustomEvent("clem-theme", { detail: "light" })); });
  await page.locator(".sidebar .nav-item").first().click();
  await shot("home-light");
  await page.setViewportSize({ width: 720, height: 800 });
  await shot("narrow-light");
  console.log(errors.length ? "page errors: " + errors.join("; ") : "no page errors");
} finally {
  await fixture.close();
  await browser.close();
}
