// Screenshots of the plan surfaces (Plan tab, Overview card, a ticked task) and a long chat title on Overview.
// node scripts/verify/plan-look.mjs [out-dir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/plan-look";
await mkdir(out, { recursive: true });
const pad = (n) => String(n).padStart(2, "0");
const D = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const reply = "Here is the plan.\n\n```plan\n" + JSON.stringify({ action: "create", space: "bio", title: "Biology midterm", goal: "Every lecture learned and one timed past paper before the midterm.", tasks: [
  { id: "t1", title: "Learn Lecture 1 (cells): read the slides, then the revision notes; draw the organelles yourself", due: D(-3), group: "Lectures" },
  { id: "t2", title: "Learn Lecture 2 (membranes)", due: D(-1), group: "Lectures" },
  { id: "q", title: "Quiz 1", due: D(1), kind: "milestone", group: "Lectures" },
  { id: "t3", title: "Learn Lecture 3 (respiration)", due: D(2), group: "Lectures" },
  { id: "t4", title: "Practise 20 respiration questions", due: D(5), group: "Practice" },
  { id: "t5", title: "Timed past paper", due: D(8), group: "Practice" },
  { id: "m", title: "Midterm", due: D(10), time: "09:00", kind: "milestone", group: "Practice" },
] }) + "\n```";
const long = { id: "c-long", title: "create a pdf or two explaining lecture 3-6. make sure it covers all. and also everything else from the slides please", spaceId: "bio", updated: Date.now(), messages: [{ id: "x1", role: "user", content: "hi" }] };
const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { replies: [reply], extraChats: [long] });
await page.getByLabel("Your message").fill("Plan it"); await page.getByLabel("Your message").press("Enter");
await page.locator(".pl-proposal").last().waitFor({ timeout: 15000 }); await page.waitForTimeout(800);
await page.getByRole("button", { name: /Save plan/ }).last().click(); await page.waitForTimeout(400);
await page.evaluate(() => { location.hash = "/app/subjects"; }); await page.waitForTimeout(500);
await page.locator(".lib-card").first().click(); await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/overview.png`, fullPage: true });
const spill = await page.evaluate(() => [...document.querySelectorAll(".sp-list.recent .sp-row")].filter((b) => b.getBoundingClientRect().right > b.closest(".sp-list").getBoundingClientRect().right + 12).length);
console.log(spill ? "FAIL a recent chat row leaves its column" : "ok   long chat titles stay in their column");
await page.getByRole("tab", { name: /Plan/ }).first().click(); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/plan-mid.png` });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/plan.png`, fullPage: true });
await page.getByRole("checkbox", { name: /Mark done: Learn Lecture 1/ }).click(); await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/plan-ticked.png`, fullPage: true });
if (errors.length) console.log("page errors:", errors);
process.exitCode = spill || errors.length ? 1 : 0;
await close(); await browser.close();
