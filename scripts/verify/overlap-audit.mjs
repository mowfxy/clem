// Overlap audit: every main screen at three widths; reports visible text boxes that collide or spill off-screen.
// node scripts/verify/overlap-audit.mjs [out-dir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/overlap-audit";
await mkdir(out, { recursive: true });
const pad = (n) => String(n).padStart(2, "0");
const D = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const plan = "Plan.\n\n```plan\n" + JSON.stringify({ action: "create", space: "bio", title: "Biology midterm plan", goal: "Every lecture reviewed.", tasks: [
  { id: "t1", title: "Review lecture 1", due: D(-1) }, { id: "q", title: "Quiz 1", due: D(1), kind: "milestone" }, { id: "t2", title: "Practise", due: D(4) }, { id: "m", title: "Midterm", due: D(9), kind: "milestone" }] }) + "\n```";
const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { replies: ["## Osmosis\n\nWater moves **towards more solute**.\n\n| A | B |\n|---|---|\n| 1 | 2 |", plan] });
const send = async (t) => { await page.getByLabel("Your message").fill(t); await page.getByLabel("Your message").press("Enter"); };
await send("Explain osmosis"); await page.locator(".message.assistant table").first().waitFor({ timeout: 15000 });
await send("Plan it"); await page.locator(".pl-proposal").first().waitFor({ timeout: 15000 }); await page.waitForTimeout(800);
await page.getByRole("button", { name: "Save plan" }).first().click(); await page.waitForTimeout(400);
const chatHash = await page.evaluate(() => location.hash);
const screens = [["chat", chatHash], ["home", "#/app"], ["visuals", "#/app/visuals"], ["projects", "#/app/projects"], ["subjects", "#/app/subjects"], ["files", "#/app/files"],
  ["subject", "#/app/space/bio"], ["subject-plan", "#/app/space/bio", "Plan"], ["subject-files", "#/app/space/bio", "Files"], ["subject-cards", "#/app/space/bio", "Flashcards"], ["subject-chats", "#/app/space/bio", "Chats"], ["subject-memory", "#/app/space/bio", "Memory"]];
const audit = () => page.evaluate(() => {
  const vw = innerWidth, hits = [];
  const els = [...document.querySelectorAll("body *")].filter((e) => {
    if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
    const s = getComputedStyle(e); if (s.visibility === "hidden" || +s.opacity === 0 || s.display === "none") return false;
    if (e.closest("[aria-hidden=true],.sr-only,svg,dialog:not([open]),[popover]:not(:popover-open)")) return false;
    const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight * 3 && r.right > 0 && r.left < vw;
  }).map((e) => {
    // The text's own box, not the element's (a block can be wider than its words).
    const range = document.createRange(); range.selectNodeContents(e); let r = range.getBoundingClientRect();
    // Text cut with an ellipsis or by a scroller only shows inside its clipping box.
    for (let p = e; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflowX !== "visible") { const c = p.getBoundingClientRect(); r = new DOMRect(Math.max(r.left, c.left), Math.max(r.top, c.top), Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left)), Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top))); } }
    return { e, r, t: e.textContent.trim().slice(0, 40) };
  });
  for (const a of els) if (a.r.right > vw + 1 && !a.e.closest("[class*=scroll],table,pre,.sp-tabs,nav")) hits.push(`off-screen: "${a.t}" right=${Math.round(a.r.right)}`);
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j]; if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (ox > 3 && oy > 3) hits.push(`overlap: "${a.t}" × "${b.t}"`);
  }
  return [...new Set(hits)].slice(0, 12);
});
let total = 0;
for (const [w, h] of [[1440, 900], [820, 1000], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const [name, hash, tab] of screens) {
    await page.evaluate((x) => { location.hash = x; }, hash); await page.waitForTimeout(700);
    if (tab) { const t = page.getByRole("tab", { name: new RegExp("^" + tab) }); if (await t.count()) { await t.first().click(); await page.waitForTimeout(900); } }
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
    const hits = await audit();
    if (hits.length) { total += hits.length; console.log(`[${w}] ${name}:`, hits); await page.screenshot({ path: `${out}/${w}-${name}.png` }); }
  }
}
if (errors.length) console.log("page errors:", errors);
console.log(total ? `${total} findings` : "overlap audit: clean");
await close(); await browser.close();
process.exit(total ? 1 : 0);
