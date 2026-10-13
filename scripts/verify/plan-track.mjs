// Plan timeline labels: Today never collides with a milestone, close milestones drop to a second row, nothing overlaps.
// node scripts/verify/plan-track.mjs [out-dir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/plan-track";
await mkdir(out, { recursive: true });
const pad = (n) => String(n).padStart(2, "0");
const D = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const block = (title, tasks) => "Here is the plan.\n\n```plan\n" + JSON.stringify({ action: "create", space: "bio", title, goal: "Learn L1-L4 from scratch, be ready for the L1-L3 quiz and the midterm, with the day before each used for revision only.", tasks }) + "\n```";
const exam = block("EC quiz and midterm", [
  { id: "t1", title: "Learn L1", due: D(-2) }, { id: "t2", title: "Learn L2", due: D(-1) },
  { id: "q", title: "EC quiz (L1-L3)", due: D(1), kind: "milestone" },
  { id: "t3", title: "Learn L3", due: D(3) }, { id: "t4", title: "Learn L4", due: D(6) }, { id: "t5", title: "Revise all", due: D(12) },
  { id: "m", title: "EC 1 midterm", due: D(13), kind: "milestone" },
]);
const crowded = block("Crowded milestones", [
  { id: "t1", title: "Start", due: D(0) },
  { id: "a", title: "Lab report one due", due: D(2), kind: "milestone" },
  { id: "b", title: "Quiz 2", due: D(3), kind: "milestone" },
  { id: "c", title: "Problem set four", due: D(4), kind: "milestone" },
  { id: "d", title: "Final exam", due: D(20), kind: "milestone" },
]);
const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { replies: [exam, crowded], deviceScaleFactor: 1 });
const send = async (t) => { await page.getByLabel("Your message").fill(t); await page.getByLabel("Your message").press("Enter"); };
let bad = 0;
const overlaps = () => page.evaluate(() => {
  const r = (e) => e.getBoundingClientRect();
  const track = document.querySelector(".pl-view .pl-track"); if (!track) return ["no track"];
  const boxes = [...track.querySelectorAll(".pl-mile-label, .pl-now em")].map((e) => ({ t: e.textContent, b: r(e) }));
  const t = r(track), hits = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i].b; if (a.left < t.left - 1 || a.right > t.right + 1) hits.push(`${boxes[i].t} leaves the chart`);
    for (let j = i + 1; j < boxes.length; j++) { const b = boxes[j].b; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits.push(`${boxes[i].t} × ${boxes[j].t}`); }
  }
  return hits;
});
for (const [i, ask] of [["1", "Plan EC"], ["2", "Plan crowded"]]) {
  await send(ask);
  await page.locator(".pl-proposal").last().waitFor({ timeout: 15000 }); await page.waitForTimeout(600);
  await page.getByRole("button", { name: /Save plan|Replace plan/ }).last().click();
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "/app/subjects"; }); await page.waitForTimeout(500);
  await page.locator(".lib-card").first().click(); await page.waitForTimeout(400);
  await page.getByRole("tab", { name: /Plan/ }).first().click(); await page.waitForTimeout(2200);
  for (const w of [1440, 900]) {
    await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(500);
    const hits = await overlaps(); if (hits.length) { bad++; console.log(`plan ${i} @${w}: overlap`, hits); }
    await page.locator(".pl-view .pl-card").first().screenshot({ path: `${out}/plan${i}-${w}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { location.hash = "/app"; }); await page.waitForTimeout(400);
}
if (errors.length) { bad++; console.log("page errors:", errors); }
await close(); await browser.close();
console.log(bad ? "FAIL" : "plan track: no overlaps"); process.exit(bad ? 1 : 0);
